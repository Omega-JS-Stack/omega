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
// The ?authSignout handler runs beside the policy listener on a real page boot,
// and #196's wedge only shows when both drive the same window.
const SESSION_PARAMS_ENTRY = path.join(CORE_DIR, 'js', 'libs', 'auth', 'session-params.js');

// Bundle once: the client resolves to a stub module that hands back whatever
// globalThis.__omegaClient holds at REQUIRE time, so each test loads the bundle
// fresh (cache-busted below) against its own stub.
const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-auth-policy-'));
const BUNDLE = path.join(BUNDLE_DIR, 'auth.cjs');
const SESSION_PARAMS_BUNDLE = path.join(BUNDLE_DIR, 'session-params.cjs');

let building = null;

function bundleModule(entryPoint, outfile) {
  return esbuild.build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    // The custom-token path imports it lazily and no test walks there; bundling
    // the whole firebase auth SDK into the harness buys nothing.
    external: ['@firebase/auth'],
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
}

function bundleOnce() {
  building ||= Promise.all([
    bundleModule(AUTH_ENTRY, BUNDLE),
    bundleModule(SESSION_PARAMS_ENTRY, SESSION_PARAMS_BUNDLE),
  ]);

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
    // `signedInUser` is the harness's stand-in for firebase's currentUser: the
    // signout handler asks whether anybody is signed in before flagging.
    signedInUser: null,
    auth: () => ({
      listen: (options, handler) => listeners.push(handler),
      signOut: async () => signOuts.push(true),
      isAuthenticated: () => !!client.signedInUser,
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
    // The real thing rewrites the address bar without navigating — the signout
    // handler strips ?authSignout through it, and the guards downstream read the
    // stripped URL.
    history: { replaceState: (state, title, url) => { href = String(url); } },
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
  delete require.cache[require.resolve(SESSION_PARAMS_BUNDLE)];
  require(BUNDLE).default();

  return {
    navigations,
    client,
    // The ?authSignout / ?authCustomToken handlers, bound to this same window.
    sessionParams: require(SESSION_PARAMS_BUNDLE),
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

test('auth policy: a stale signed-in state after the authSignout param is stripped keeps the page (#196)', async () => {
  const { navigations, fire } = await boot({
    href: 'https://brand.test/signin',
    policy: 'unauthenticated',
    redirects: REDIRECTS,
    pagePath: '/signin',
  });

  // What handleAuthSignout leaves behind mid-signout: the flag set, and the URL
  // already stripped of ?authSignout — so only the flag can catch the stale event.
  window.__OMEGA_SIGNOUT_IN_PROGRESS = true;

  await fire({ user: { uid: 'u1' }, account: SETTLED_ACCOUNT });

  assert.deepStrictEqual(navigations, [], 'the stale signed-in event must not bounce off /signin');
  assert.strictEqual(window.__OMEGA_SIGNOUT_IN_PROGRESS, true, 'the flag holds until the signed-out event lands');

  // The signed-out event the flag was waiting for: clears it, page stays put.
  await fire({ user: null, account: null });

  assert.strictEqual(window.__OMEGA_SIGNOUT_IN_PROGRESS, false);
  assert.deepStrictEqual(navigations, []);
});

test('auth policy: the signed-out state clears the signout flag and falls through to the normal path', async () => {
  const { navigations, fire } = await boot({
    href: 'https://brand.test/dashboard/account',
    policy: 'authenticated',
    redirects: REDIRECTS,
  });

  window.__OMEGA_SIGNOUT_IN_PROGRESS = true;

  await fire({ user: null, account: null });

  assert.strictEqual(window.__OMEGA_SIGNOUT_IN_PROGRESS, false);
  assert.deepStrictEqual(navigations, [
    'https://brand.test/signin?authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount',
  ], 'no authReturnUrl to stay for — the authenticated page still kicks the user out');
});

test('auth policy: a signed-OUT visit to ?authSignout=true never wedges the next sign-in (#196)', async () => {
  const { navigations, fire, client, sessionParams } = await boot({
    href: 'https://brand.test/signin?authSignout=true',
    policy: 'unauthenticated',
    redirects: REDIRECTS,
    pagePath: '/signin',
  });

  // Nobody is signed in — checkout's switch-account link and the legacy reset
  // redirects both land here. signOut() changes no uid, so firebase fires NO
  // state change, so nothing would ever clear a flag set now.
  client.signedInUser = null;

  await sessionParams.handleAuthSignout();

  assert.strictEqual(window.__OMEGA_SIGNOUT_IN_PROGRESS, undefined, 'no state change is coming — the flag must not be set');
  assert.deepStrictEqual(client.signOuts, [true], 'the signOut still runs unconditionally');
  assert.strictEqual(window.location.href, 'https://brand.test/signin', 'and the param is still stripped');

  // The user signs in on this same page load: the policy must still bounce them.
  await fire({ user: { uid: 'u1' }, account: SETTLED_ACCOUNT });

  assert.deepStrictEqual(navigations, ['https://brand.test/dashboard/account'], 'a swallowed sign-in strands the user on /signin');
});

test('auth policy: a signed-IN visit to ?authSignout=true still flags the signout for the listener', async () => {
  const { fire, client, sessionParams } = await boot({
    href: 'https://brand.test/dashboard/account?authSignout=true',
    policy: 'authenticated',
    redirects: REDIRECTS,
  });

  client.signedInUser = { uid: 'u1' };

  await sessionParams.handleAuthSignout();

  assert.strictEqual(window.__OMEGA_SIGNOUT_IN_PROGRESS, true, 'a real signout is in flight — the flag guards the stale event');

  // The signed-out state change the flag was waiting for clears it.
  await fire({ user: null, account: null });

  assert.strictEqual(window.__OMEGA_SIGNOUT_IN_PROGRESS, false);
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
