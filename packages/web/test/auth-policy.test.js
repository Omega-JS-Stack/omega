/**
 * The page auth policy (`core/js/core/auth.js`) — the browser-side listener that
 * decides, on every auth state change, whether the current page keeps the user
 * or navigates them away: the kick-out on a `policy: 'authenticated'` page, the
 * bounce off a `policy: 'unauthenticated'` page, the one sanctioned skip
 * (`?authSignout=true` + `authReturnUrl`), and the full opt-out (`disabled`).
 *
 * The module is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL file through esbuild —
 * already a dependency here, and the same aliases src/assets.js resolves at
 * build time — with the client swapped for a stub and window/document
 * hand-rolled to the minimum the module touches (the convention the
 * language-switcher suite set: node has no DOM and web pulls in no jsdom).
 * Navigation is the assertion: `redirect()` writes `window.location.href`, so
 * every case reads as the list of hrefs the page tried to go to.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const AUTH_ENTRY = path.join(CORE_DIR, 'js', 'core', 'auth.js');

// Bundle once: the client resolves to a stub module that hands back whatever
// globalThis.__omegaClient holds at REQUIRE time, so each test loads the bundle
// fresh (cache-busted below) against its own stub.
const BUNDLE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-auth-policy-')), 'auth.cjs');

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
      },
    }],
  });

  return building;
}

/** The minimum client the module reaches for, plus the captured listener. */
function makeClient({ policy, roles = null, redirects = {} }) {
  const listeners = [];
  const signOuts = [];

  const client = {
    listeners,
    signOuts,
    config: {
      auth: { config: { policy, roles, redirects } },
      analytics: { meta: 'META-PIXEL' },
    },
    auth: () => ({
      listen: (options, handler) => listeners.push(handler),
      signOut: async () => signOuts.push(true),
    }),
    isValidRedirectUrl: () => true,
    notifications: () => ({ subscribe: async () => {} }),
    utilities: () => ({ showNotification: () => {}, getContext: () => ({}) }),
    storage: () => ({ get: (key, fallback) => fallback }),
    request: async () => ({}),
  };

  return client;
}

/** The minimum browser the module touches; returns the navigation log. */
function makeBrowser({ href, pagePath = '/dashboard/account' }) {
  const navigations = [];

  globalThis.window = {
    location: {
      get href() { return href; },
      set href(value) { navigations.push(String(value)); },
      get origin() { return new URL(href).origin; },
      get hostname() { return new URL(href).hostname; },
      get pathname() { return new URL(href).pathname; },
    },
    history: { replaceState: () => {} },
  };

  globalThis.document = {
    title: 'test',
    documentElement: { getAttribute: (name) => (name === 'data-page-path' ? pagePath : null) },
    querySelectorAll: () => [],
  };

  // The analytics pixels the module sets a user id on, unconditionally.
  globalThis.gtag = () => {};
  globalThis.fbq = () => {};
  globalThis.ttq = { identify: () => {} };

  return navigations;
}

/** Boot the real module against one stub client + browser; hand back the seams. */
async function boot({ href, policy, roles, redirects, pagePath }) {
  await bundleOnce();

  const client = makeClient({ policy, roles, redirects });
  const navigations = makeBrowser({ href, pagePath });

  globalThis.__omegaClient = client;
  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).default();

  return {
    navigations,
    client,
    // The listener the module registered (undefined when policy short-circuited).
    fire: (state) => client.listeners[0](state),
  };
}

// A signed-up, consent-granted account: past both the signup-metadata post and
// the consent guard, so a test reads as policy only.
const SETTLED_ACCOUNT = {
  flags: { signupProcessed: true },
  consent: { legal: { status: 'granted' } },
};

const REDIRECTS = { authenticated: '/dashboard/account', unauthenticated: '/signin' };

test('auth policy: signed out on an authenticated page kicks the user to signin with a return url', async () => {
  const { navigations, fire } = await boot({
    href: 'https://brand.test/dashboard/account',
    policy: 'authenticated',
    redirects: REDIRECTS,
  });

  await fire({ user: null, account: null });

  assert.deepStrictEqual(navigations, [
    'https://brand.test/signin?authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount',
  ]);
});

test('auth policy: signed in on an unauthenticated page bounces to the authenticated destination', async () => {
  const { navigations, fire } = await boot({
    href: 'https://brand.test/signin',
    policy: 'unauthenticated',
    redirects: REDIRECTS,
    pagePath: '/signin',
  });

  await fire({ user: { uid: 'u1', email: 'a@b.co' }, account: SETTLED_ACCOUNT });

  assert.deepStrictEqual(navigations, ['https://brand.test/dashboard/account']);
});

test('auth policy: signed in on an unauthenticated page prefers authReturnUrl over the default', async () => {
  const { navigations, fire } = await boot({
    href: 'https://brand.test/signin?authReturnUrl=https%3A%2F%2Fbrand.test%2Fpricing',
    policy: 'unauthenticated',
    redirects: REDIRECTS,
    pagePath: '/signin',
  });

  await fire({ user: { uid: 'u1' }, account: SETTLED_ACCOUNT });

  assert.deepStrictEqual(navigations, ['https://brand.test/pricing']);
});

test('auth policy: a signout in flight with an authReturnUrl keeps the user on the page', async () => {
  const { navigations, fire } = await boot({
    href: 'https://brand.test/dashboard/account?authSignout=true&authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount',
    policy: 'authenticated',
    redirects: REDIRECTS,
  });

  // The signout pass: still signed in, param present — sets justSignedOut.
  await fire({ user: { uid: 'u1' }, account: SETTLED_ACCOUNT });
  // The state change the signout produces: no kick-out, the page re-authenticates.
  await fire({ user: null, account: null });

  assert.deepStrictEqual(navigations, []);
});

test('auth policy: the suppression is one-shot — the next signed-out state still kicks out', async () => {
  const { navigations, fire } = await boot({
    href: 'https://brand.test/dashboard/account?authSignout=true&authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount',
    policy: 'authenticated',
    redirects: REDIRECTS,
  });

  await fire({ user: { uid: 'u1' }, account: SETTLED_ACCOUNT });
  await fire({ user: null, account: null });
  await fire({ user: null, account: null });

  assert.deepStrictEqual(navigations, [
    'https://brand.test/signin?authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount%3FauthSignout%3Dtrue%26authReturnUrl%3Dhttps%253A%252F%252Fbrand.test%252Fdashboard%252Faccount',
  ]);
});

test('auth policy: policy disabled registers no listener and never navigates', async () => {
  const { navigations, client } = await boot({
    href: 'https://brand.test/vert/iframe',
    policy: 'disabled',
    redirects: REDIRECTS,
  });

  assert.deepStrictEqual(client.listeners, [], 'no auth listener is set up at all');
  assert.deepStrictEqual(navigations, []);
});

test('auth policy: a signed-out visitor to a public page stays put', async () => {
  const { navigations, fire } = await boot({
    href: 'https://brand.test/pricing',
    policy: 'public',
    redirects: REDIRECTS,
    pagePath: '/pricing',
  });

  await fire({ user: null, account: null });

  assert.deepStrictEqual(navigations, []);
});

test('auth policy: a signed-in user missing a required role is sent to the authenticated destination', async () => {
  const { navigations, fire } = await boot({
    href: 'https://brand.test/dashboard/admin',
    policy: 'authenticated',
    roles: { admin: true },
    redirects: REDIRECTS,
  });

  await fire({ user: { uid: 'u1' }, account: SETTLED_ACCOUNT });

  assert.deepStrictEqual(navigations, ['https://brand.test/dashboard/account']);
});
