/**
 * The gate on the post-auth signup request (`core/js/core/auth.js`'s
 * `sendUserSignupMetadata`) — [#633](https://github.com/Omega-JS-Stack/omega/issues/633).
 *
 * `flags.signupProcessed` alone cannot hold the gate: the route polls for the
 * user doc and infers the contact before it writes the flag, so every page load
 * inside that window reads an unprocessed doc and posts again (three posts in
 * six seconds on the live playground). The per-uid in-flight marker closes the
 * window from the browser side: set when the POST starts, cleared by a page load
 * that sees the flag true — and cleared on the spot by a send that failed, so a
 * post that never landed retries instead of holding the gate. The one failure
 * that KEEPS the marker is the server's "already processed" 400: that work is
 * done and the flag is landing right behind it.
 *
 * The marker lives in the client's storage module (localStorage) under the
 * `temporary.` prefix, so it carries its own expiry: a tab that died between
 * "mark in flight" and the POST's answer would otherwise gate that account for
 * good, and an expired marker reads as absent.
 *
 * Same harness as signup-metadata-cookies.test.js: the module is browser code
 * behind two bundler aliases, so esbuild drives the REAL file.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { get: _get, set: _set } = require('lodash');
const { User } = require('@omega.js/account');

const CORE_DIR = path.join(__dirname, '..', 'core');
const AUTH_ENTRY = path.join(CORE_DIR, 'js', 'core', 'auth.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-signup-gate-'));
const BUNDLE = path.join(BUNDLE_DIR, 'auth.cjs');

const UID = 'rEfUKtestuid';
const MARKER_PATH = `temporary.signupMetadata.${UID}`;
const SIGNUP_MARKER_TTL_MS = 10 * 60 * 1000;

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [AUTH_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        build.onResolve({ filter: /^@omega\.js\/client\// }, () => {
          return { path: 'client-modules', namespace: 'omega-client-modules-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-modules-stub' }, () => {
          return {
            contents: `export const analytics = {
              configure() {},
              event() {},
              transports: { browser: {} },
              createConsentGate: () => ({ granted: () => false }),
              identity: {},
            };`,
          };
        });
      },
    }],
  });

  return building;
}

/** One page load: the real gate, a seeded storage tree, the requests it made. */
async function pageLoad({ user, stored = {}, requestError = null } = {}) {
  await bundleOnce();

  const storage = { attribution: {}, consent: {}, trackingConsent: null };
  const requests = [];

  // Seed the marker the way the storage module holds one: a path, a value.
  Object.entries(stored).forEach(([keyPath, value]) => _set(storage, keyPath, value));

  globalThis.window = {
    location: { href: 'https://brand.test/pricing', search: '' },
  };
  globalThis.document = {
    cookie: '',
    documentElement: { getAttribute: () => '/pricing' },
  };
  globalThis.__omegaClient = {
    config: { environment: 'production', analytics: { providers: {} } },
    isDevelopment: () => false,
    storage: {
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      // The module's own remove(): set the path to undefined, which is what
      // JSON.stringify drops on the way into localStorage.
      remove: (keyPath) => _set(storage, keyPath, undefined),
    },
    utilities: {
      getContext: () => ({ client: { platform: 'macos' } }),
      showNotification: () => {},
    },
    request: async (url, options) => {
      requests.push({ url, options });
      if (requestError) {
        throw requestError;
      }

      return { signedUp: true };
    },
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const auth = require(BUNDLE);

  await auth.sendUserSignupMetadata(globalThis.__omegaClient, user);

  return { requests: requests, marker: _get(storage, MARKER_PATH) };
}

const UNPROCESSED = new User({ flags: { signupProcessed: false } }, { uid: UID });
const PROCESSED = new User({ flags: { signupProcessed: true } }, { uid: UID });

module.exports = defineCases({
  type: 'group',
  description: 'signup-metadata-gate',
  tests: [
    {
      name: 'signup gate: an unprocessed doc with no marker posts, and marks the post in flight',
      run: async (ctx) => {
        const { requests, marker } = await pageLoad({ user: UNPROCESSED });

        ctx.expect(requests.length, 'the first page load after signup still posts').toBe(1);
        ctx.expect(requests[0].url).toBe('/omega/user/signup');
        ctx.expect(marker, 'the in-flight marker is keyed by uid').toBeTruthy();
      },
    },

    {
      name: 'signup gate: an unprocessed doc posts nothing while the marker is fresh',
      run: async (ctx) => {
        const { requests, marker } = await pageLoad({
          user: UNPROCESSED,
          stored: { [MARKER_PATH]: Date.now() },
        });

        ctx.expect(requests, 'the doc has not caught up yet — the marker holds the gate').toEqual([]);
        ctx.expect(marker, 'and the marker stays until a page load sees the flag').toBeTruthy();
      },
    },

    {
      name: 'signup gate: a marker older than the TTL reads as absent — the post goes out again',
      run: async (ctx) => {
        const expired = Date.now() - (SIGNUP_MARKER_TTL_MS + 1000);
        const { requests, marker } = await pageLoad({
          user: UNPROCESSED,
          stored: { [MARKER_PATH]: expired },
        });

        ctx.expect(requests.length, 'a tab that died mid-POST must not gate the account for good').toBe(1);
        ctx.expect(marker > expired, 'and this post marks itself in flight with a fresh timestamp').toBeTruthy();
      },
    },

    {
      name: 'signup gate: another user in the same browser is not blocked by the marker',
      run: async (ctx) => {
        const { requests } = await pageLoad({
          user: new User({ flags: { signupProcessed: false } }, { uid: 'someone-else' }),
          stored: { [MARKER_PATH]: Date.now() },
        });

        ctx.expect(requests.length, 'the marker is per uid, not per browser').toBe(1);
      },
    },

    {
      name: 'signup gate: a post that never landed clears the marker — the retry is not blocked',
      run: async (ctx) => {
        const network = await pageLoad({ user: UNPROCESSED, requestError: new Error('Failed to fetch') });
        ctx.expect(network.requests.length).toBe(1);
        ctx.expect(network.marker, 'a dead network leaves no gate behind').toBe(undefined);

        const serverFault = new Error('Request failed with status 500');
        serverFault.code = 500;
        const failed = await pageLoad({ user: UNPROCESSED, requestError: serverFault });
        ctx.expect(failed.marker, 'a 500 leaves no gate behind either').toBe(undefined);
      },
    },

    {
      name: 'signup gate: the server\'s "already processed" 400 KEEPS the marker — the doc is about to show the flag',
      run: async (ctx) => {
        const alreadyProcessed = new Error('Signup has already been processed');
        alreadyProcessed.code = 400;

        const { requests, marker } = await pageLoad({ user: UNPROCESSED, requestError: alreadyProcessed });

        ctx.expect(requests.length).toBe(1);
        ctx.expect(marker, 'the work is done — re-posting would only collect the same 400').toBeTruthy();
      },
    },

    {
      name: 'signup gate: a processed doc posts nothing and clears the marker',
      run: async (ctx) => {
        const { requests, marker } = await pageLoad({
          user: PROCESSED,
          stored: { [MARKER_PATH]: Date.now() },
        });

        ctx.expect(requests, 'a processed account never posts again').toEqual([]);
        ctx.expect(marker, 'the doc caught up, so the marker is done').toBe(undefined);
      },
    },
  ],
});
