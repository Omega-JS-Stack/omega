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
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { get: _get, set: _set } = require('lodash');

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
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
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
async function pageLoad({ account, stored = {}, requestError = null } = {}) {
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
    storage: () => ({
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      // The module's own remove(): set the path to undefined, which is what
      // JSON.stringify drops on the way into localStorage.
      remove: (keyPath) => _set(storage, keyPath, undefined),
    }),
    utilities: () => ({
      getContext: () => ({ client: { platform: 'macos' } }),
      showNotification: () => {},
    }),
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

  await auth.sendUserSignupMetadata(account);

  return { requests: requests, marker: _get(storage, MARKER_PATH) };
}

const UNPROCESSED = { auth: { uid: UID }, flags: { signupProcessed: false } };
const PROCESSED = { auth: { uid: UID }, flags: { signupProcessed: true } };

test('signup gate: an unprocessed doc with no marker posts, and marks the post in flight', async () => {
  const { requests, marker } = await pageLoad({ account: UNPROCESSED });

  assert.strictEqual(requests.length, 1, 'the first page load after signup still posts');
  assert.strictEqual(requests[0].url, '/omega/user/signup');
  assert.ok(marker, 'the in-flight marker is keyed by uid');
});

test('signup gate: an unprocessed doc posts nothing while the marker is fresh', async () => {
  const { requests, marker } = await pageLoad({
    account: UNPROCESSED,
    stored: { [MARKER_PATH]: Date.now() },
  });

  assert.deepStrictEqual(requests, [], 'the doc has not caught up yet — the marker holds the gate');
  assert.ok(marker, 'and the marker stays until a page load sees the flag');
});

test('signup gate: a marker older than the TTL reads as absent — the post goes out again', async () => {
  const expired = Date.now() - (SIGNUP_MARKER_TTL_MS + 1000);
  const { requests, marker } = await pageLoad({
    account: UNPROCESSED,
    stored: { [MARKER_PATH]: expired },
  });

  assert.strictEqual(requests.length, 1, 'a tab that died mid-POST must not gate the account for good');
  assert.ok(marker > expired, 'and this post marks itself in flight with a fresh timestamp');
});

test('signup gate: another user in the same browser is not blocked by the marker', async () => {
  const { requests } = await pageLoad({
    account: { auth: { uid: 'someone-else' }, flags: { signupProcessed: false } },
    stored: { [MARKER_PATH]: Date.now() },
  });

  assert.strictEqual(requests.length, 1, 'the marker is per uid, not per browser');
});

test('signup gate: a post that never landed clears the marker — the retry is not blocked', async () => {
  const network = await pageLoad({ account: UNPROCESSED, requestError: new Error('Failed to fetch') });
  assert.strictEqual(network.requests.length, 1);
  assert.strictEqual(network.marker, undefined, 'a dead network leaves no gate behind');

  const serverFault = new Error('Request failed with status 500');
  serverFault.code = 500;
  const failed = await pageLoad({ account: UNPROCESSED, requestError: serverFault });
  assert.strictEqual(failed.marker, undefined, 'a 500 leaves no gate behind either');
});

test('signup gate: the server\'s "already processed" 400 KEEPS the marker — the doc is about to show the flag', async () => {
  const alreadyProcessed = new Error('Signup has already been processed');
  alreadyProcessed.code = 400;

  const { requests, marker } = await pageLoad({ account: UNPROCESSED, requestError: alreadyProcessed });

  assert.strictEqual(requests.length, 1);
  assert.ok(marker, 'the work is done — re-posting would only collect the same 400');
});

test('signup gate: a processed doc posts nothing and clears the marker', async () => {
  const { requests, marker } = await pageLoad({
    account: PROCESSED,
    stored: { [MARKER_PATH]: Date.now() },
  });

  assert.deepStrictEqual(requests, [], 'a processed account never posts again');
  assert.strictEqual(marker, undefined, 'the doc caught up, so the marker is done');
});
