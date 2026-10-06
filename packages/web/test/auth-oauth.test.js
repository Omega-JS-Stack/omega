/**
 * The OAuth flow module (`core/js/libs/auth/oauth.js`) — the popup-vs-redirect
 * decision and the return leg of a redirect sign-in.
 *
 * Two behaviors are pinned here, both from Ian's live emulator QA: development
 * MUST use the popup (the emulator hands its credential back through
 * sessionStorage on its own origin, which Chrome's third-party storage
 * partitioning hides from the SDK iframe on the site's origin, so
 * getRedirectResult() resolves null and the page dead-ends), and a return with
 * no result after a redirect we started is LOUD, not a silent empty form.
 *
 * Same harness convention as auth-policy.test.js: the REAL module through
 * esbuild behind the two bundler aliases, with the client stubbed here, the
 * @firebase/auth stub shared with that suite (test/lib/firebase-auth-stub.js),
 * and window hand-rolled to the minimum the module touches.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { firebaseAuthStub } = require('./lib/firebase-auth-stub.js');

const CORE_DIR = path.join(__dirname, '..', 'core');
const OAUTH_ENTRY = path.join(CORE_DIR, 'js', 'libs', 'auth', 'oauth.js');

const BUNDLE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-auth-oauth-')), 'oauth.cjs');

const FIREBASE_AUTH_STUB = firebaseAuthStub();

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [OAUTH_ENTRY],
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
        build.onResolve({ filter: FIREBASE_AUTH_STUB.filter }, () => {
          return { path: 'firebase-auth', namespace: 'firebase-auth-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'firebase-auth-stub' }, () => {
          return { contents: FIREBASE_AUTH_STUB.contents };
        });
      },
    }],
  });

  return building;
}

/** The minimum client the module reaches for, plus the captured Sentry calls. */
function makeClient({ development = false } = {}) {
  const captured = [];

  return {
    captured,
    isDevelopment: () => development,
    sentry: { captureException: (e) => captured.push(e.message) },
    utilities: { showNotification: () => {} },
    isValidRedirectUrl: () => true,
  };
}

/** The minimum browser the module touches, with a real per-test sessionStorage. */
function makeBrowser({ href = 'https://brand.test/signin', store = {}, top = null } = {}) {
  const sessionStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
  };

  globalThis.window = {
    location: { href },
    history: { replaceState: () => {} },
    sessionStorage,
  };
  globalThis.window.top = top || globalThis.window;

  globalThis.document = {
    title: 'test',
    documentElement: { getAttribute: () => '/signin' },
  };

  return store;
}

/** Load the real module against one stub client + browser. */
async function load({ development, href, store, top } = {}) {
  await bundleOnce();

  const client = makeClient({ development });
  const state = makeBrowser({ href, store, top });

  globalThis.__omegaClient = client;
  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];

  return { module: require(BUNDLE), client, store: state };
}

/** A FormManager that records what the user was shown. */
function makeFormManager() {
  const errors = [];

  return { errors, showError: (m) => errors.push(m), showSuccess: () => {}, ready: () => {} };
}

module.exports = defineCases({
  type: 'group',
  description: 'auth-oauth',
  tests: [
    {
      name: 'oauth: development runs the redirect flow too — the dev server proxies the emulator same-origin (#156)',
      run: async (ctx) => {
        const { module } = await load({ development: true });

        ctx.expect(module.shouldUseAuthPopup()).toBe(false);
      },
    },

    {
      name: 'oauth: ?authPopup=true still forces the popup in development',
      run: async (ctx) => {
        const { module } = await load({ development: true, href: 'https://localhost:4000/signin?authPopup=true' });

        ctx.expect(module.shouldUseAuthPopup()).toBe(true);
      },
    },

    {
      name: 'oauth: an iframed development auth page still uses the popup',
      run: async (ctx) => {
        const { module } = await load({ development: true, top: { name: 'parent' } });

        ctx.expect(module.shouldUseAuthPopup()).toBe(true);
      },
    },

    {
      name: 'oauth: production defaults to the redirect flow',
      run: async (ctx) => {
        const { module } = await load({ development: false });

        ctx.expect(module.shouldUseAuthPopup()).toBe(false);
      },
    },

    {
      name: 'oauth: ?authPopup=true forces the popup in production',
      run: async (ctx) => {
        const { module } = await load({ development: false, href: 'https://brand.test/signin?authPopup=true' });

        ctx.expect(module.shouldUseAuthPopup()).toBe(true);
      },
    },

    {
      name: 'oauth: an iframed auth page uses the popup',
      run: async (ctx) => {
        const { module } = await load({ development: false, top: { name: 'parent' } });

        ctx.expect(module.shouldUseAuthPopup()).toBe(true);
      },
    },

    {
      name: 'oauth: starting a redirect marks the tab as pending',
      run: async (ctx) => {
        const { module, store } = await load({ development: false });

        const redirects = [];
        globalThis.__firebaseAuth = {
          getAuth: () => ({}),
          signInWithRedirect: async (auth, provider) => redirects.push(provider),
        };

        await module.signInWithProvider({ formManager: makeFormManager(), useAuthPopup: false }, 'google.com');

        ctx.expect(redirects.length).toBe(1);
        ctx.expect('omega:authRedirectPending' in store, 'the pending marker is written before the navigation').toBeTruthy();
      },
    },

    {
      name: 'oauth: returning from a redirect with no result shows an error and reports it',
      run: async (ctx) => {
        const { module, client, store } = await load({
          development: false,
          store: { 'omega:authRedirectPending': '1' },
        });

        globalThis.__firebaseAuth = {
          getAuth: () => ({}),
          getRedirectResult: async () => null,
        };

        const formManager = makeFormManager();
        const handled = await module.handleRedirectResult({ formManager });

        ctx.expect(handled, 'no redirect result was processed').toBe(false);
        ctx.expect(formManager.errors).toEqual(['Sign-in did not complete. Please try again.']);
        ctx.expect(client.captured).toEqual(['OAuth redirect returned no result']);
        ctx.expect(!('omega:authRedirectPending' in store), 'the marker is one-shot').toBeTruthy();
      },
    },

    {
      name: 'oauth: a rejected redirect clears the pending marker — no stale error next load',
      run: async (ctx) => {
        const { module, store } = await load({ development: false });

        globalThis.__firebaseAuth = {
          getAuth: () => ({}),
          signInWithRedirect: async () => { throw Object.assign(new Error('network down'), { code: 'auth/network-request-failed' }); },
        };

        const formManager = makeFormManager();
        await ctx.expect((() => module.signInWithProvider({ formManager, useAuthPopup: false }, 'google.com'))()).rejects.toThrow();

        ctx.expect(!('omega:authRedirectPending' in store), 'a redirect that never left the page is not pending').toBeTruthy();
      },
    },

    {
      name: 'oauth: a plain page load with no redirect pending stays quiet',
      run: async (ctx) => {
        const { module, client } = await load({ development: false });

        globalThis.__firebaseAuth = {
          getAuth: () => ({}),
          getRedirectResult: async () => null,
        };

        const formManager = makeFormManager();
        const handled = await module.handleRedirectResult({ formManager });

        ctx.expect(handled).toBe(false);
        ctx.expect(formManager.errors).toEqual([]);
        ctx.expect(client.captured).toEqual([]);
      },
    },
  ],
});
