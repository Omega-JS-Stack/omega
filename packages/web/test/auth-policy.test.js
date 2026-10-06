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
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { firebaseAuthStub } = require('./lib/firebase-auth-stub.js');
const { User } = require('@omega.js/account');

const CORE_DIR = path.join(__dirname, '..', 'core');
const AUTH_ENTRY = path.join(CORE_DIR, 'js', 'core', 'auth.js');
// The ?authSignout handler runs beside the policy listener on a real page boot,
// and #196's wedge only shows when both drive the same window.
const SESSION_PARAMS_ENTRY = path.join(CORE_DIR, 'js', 'libs', 'auth', 'session-params.js');
// The auth PAGES orchestrator — the other half of a /signin or /signup boot: it
// disables the form, runs the OAuth return leg, and re-enables (#701).
const AUTH_PAGES_ENTRY = path.join(CORE_DIR, 'js', 'libs', 'auth', 'index.js');

// Bundle once: the client resolves to a stub module that hands back whatever
// globalThis.__omegaClient holds at REQUIRE time, so each test loads the bundle
// fresh (cache-busted below) against its own stub.
const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-auth-policy-'));
const BUNDLE = path.join(BUNDLE_DIR, 'auth.cjs');
const SESSION_PARAMS_BUNDLE = path.join(BUNDLE_DIR, 'session-params.cjs');
const AUTH_PAGES_BUNDLE = path.join(BUNDLE_DIR, 'auth-pages.cjs');

// The pages boot reaches two specifiers past the shared aliases: the real
// FormManager wants a live DOM, and the return leg lazily imports the firebase
// SDK. Both become harness modules reading their own globalThis seam, the same
// deal the client stub gets — the firebase one shared with auth-oauth.test.js.
const PAGES_STUBS = [
  firebaseAuthStub(),
  {
    filter: /^@omega\.js\/client\/modules\/form-manager\.js$/,
    contents: 'export const FormManager = function (...args) { return globalThis.__makeFormManager(...args); };',
  },
];

let building = null;

/**
 * One bundle per entry. `stubs` adds harness modules for the specifiers an
 * entry pulls in beyond the two shared aliases; a stubbed specifier is no
 * longer external, since the stub IS the module the bundle should carry.
 */
function bundleModule(entryPoint, outfile, stubs = []) {
  return esbuild.build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    // The custom-token and private-key paths import it lazily; a suite that
    // walks one passes the stub, and bundling the real SDK buys nothing.
    external: ['@firebase/auth'].filter((specifier) => !stubs.some((stub) => stub.filter.test(specifier))),
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

        stubs.forEach((stub, index) => {
          const namespace = `harness-stub-${index}`;
          build.onResolve({ filter: stub.filter }, () => ({ path: namespace, namespace }));
          build.onLoad({ filter: /.*/, namespace }, () => ({ contents: stub.contents }));
        });
      },
    }],
  });
}

function bundleOnce() {
  building ||= Promise.all([
    bundleModule(AUTH_ENTRY, BUNDLE),
    // The ?authPrivateKey lane signs in through the SDK, so this bundle carries
    // the firebase stub too (#661).
    bundleModule(SESSION_PARAMS_ENTRY, SESSION_PARAMS_BUNDLE, [firebaseAuthStub()]),
    bundleModule(AUTH_PAGES_ENTRY, AUTH_PAGES_BUNDLE, PAGES_STUBS),
  ]);

  return building;
}

/** The minimum client the module reaches for, plus the captured listener. */
function makeClient({ policy, roles = null, redirects = {} }) {
  const listeners = [];
  const signOuts = [];
  const requests = [];
  const notificationsShown = [];
  const sentryCaptures = [];
  // A request that never answers, so a test can watch what the listener does
  // WHILE the signup post is still in flight (#700).
  let requestsBlocked = false;
  // What the backend answers, for the lanes that read the response body (#661).
  let requestAnswer = null;

  const client = {
    listeners,
    signOuts,
    requests,
    notificationsShown,
    sentryCaptures,
    blockRequests: () => { requestsBlocked = true; },
    answerRequests: (answer) => { requestAnswer = answer; },
    config: {
      auth: { config: { policy, roles, redirects } },
      analytics: { meta: 'META-PIXEL' },
    },
    auth: {
      // The client's live User: the signout handler asks whether anybody is
      // signed in before flagging.
      user: new User(),
      listen: (options, handler) => listeners.push(handler),
      signOut: async () => signOuts.push(true),
    },
    isValidRedirectUrl: () => true,
    notifications: { subscribe: async () => {} },
    // The url rides with the capture: Sentry's httpContext integration reads
    // window.location.href AT CAPTURE TIME, so a key still in the address bar
    // when captureException runs is a key inside the event (#661).
    sentry: { captureException: (error) => sentryCaptures.push({ error, url: window.location.href }) },
    utilities: {
      showNotification: (message, options) => notificationsShown.push({ message, options }),
      getContext: () => ({}),
    },
    storage: {
      get: (key, fallback) => fallback,
      set: () => {},
      remove: () => {},
    },
    request: async (url, options) => {
      requests.push({ url, options });

      if (requestsBlocked) {
        return new Promise(() => {});
      }

      return requestAnswer ? requestAnswer(url, options) : {};
    },
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
async function boot({ href, policy, roles, redirects, pagePath, firebaseAuth }) {
  await bundleOnce();

  const client = makeClient({ policy, roles, redirects });
  const navigations = makeBrowser({ href, pagePath });

  globalThis.__omegaClient = client;
  // Only the session-params sign-in lanes reach for it (#661).
  globalThis.__firebaseAuth = firebaseAuth;
  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  delete require.cache[require.resolve(SESSION_PARAMS_BUNDLE)];
  require(BUNDLE).default({ omega: globalThis.__omegaClient });

  return {
    navigations,
    client,
    // The ?authSignout / ?authCustomToken / ?authPrivateKey handlers, bound to
    // this same window.
    sessionParams: require(SESSION_PARAMS_BUNDLE),
    // The listener the module registered (undefined when policy short-circuited).
    fire: (state) => client.listeners[0](state),
  };
}

// A signed-up account: past the signup-metadata post, so a test reads as policy only.
const SETTLED_ACCOUNT = {
  flags: { signupProcessed: true },
  consent: { legal: { status: 'granted' } },
};

// The seconds after a signup: the account doc exists (or resolves empty) but the
// route has not written flags.signupProcessed yet. The NORMAL state, not a
// failure — it is what makes the listener post the signup metadata (#700).
const PENDING_ACCOUNT = { flags: { signupProcessed: false } };

const REDIRECTS = { authenticated: '/dashboard/account', unauthenticated: '/signin' };

/**
 * Everything the modules printed while `run()` ran. createLogger resolves
 * `console[method]` at ACCESS time precisely so a test can swap it — and a
 * credential in the URL is only safe if nothing ever prints it (#661).
 */
async function captureConsole(run) {
  const printed = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const real = {};

  methods.forEach((method) => {
    real[method] = console[method];
    console[method] = (...args) => printed.push(args.map((arg) => String(arg)).join(' '));
  });

  try {
    return { result: await run(), printed };
  } finally {
    Object.assign(console, real);
  }
}

/** A FormManager that records what the user was shown and what it let them do. */
function makeFormManager() {
  const errors = [];
  const calls = [];

  return {
    errors,
    calls,
    $form: { addEventListener: () => {}, querySelectorAll: () => [] },
    on: () => {},
    _setDisabled: (disabled) => calls.push(`_setDisabled(${disabled})`),
    ready: () => calls.push('ready()'),
    showError: (message) => { calls.push('showError()'); errors.push(message); },
    showSuccess: () => calls.push('showSuccess()'),
  };
}

/** Boot the REAL auth-pages module on one page, against one firebase stub. */
async function bootAuthPage({ href, pagePath, firebaseAuth }) {
  await bundleOnce();

  const client = makeClient({ policy: 'unauthenticated', redirects: REDIRECTS });
  const navigations = makeBrowser({ href, pagePath });
  const formManager = makeFormManager();

  // The page boot touches more of the browser than the policy listener does:
  // the form lookups, the provider-button wiring, and the redirect marker.
  globalThis.document.querySelector = () => null;
  globalThis.document.getElementById = () => null;
  globalThis.window.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.window.top = globalThis.window;

  // What the boot needs beyond the policy listener's client: the DOM-ready gate
  // it hangs off, the production answer (no dev simulation), and Sentry.
  client.dom = { ready: async () => {} };
  client.isDevelopment = () => false;
  client.sentry = { captureException: () => {} };

  globalThis.__omegaClient = client;
  globalThis.__firebaseAuth = firebaseAuth;
  globalThis.__makeFormManager = () => formManager;
  delete require.cache[require.resolve(AUTH_PAGES_BUNDLE)];
  require(AUTH_PAGES_BUNDLE).default();

  // The boot is a promise chain off dom.ready() with nothing to await from
  // out here: let it run to its end before reading what the user was left with.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return { formManager, navigations, client };
}

module.exports = defineCases({
  type: 'group',
  description: 'auth-policy',
  tests: [
    {
      name: 'auth policy: signed out on an authenticated page kicks the user to signin with a return url',
      run: async (ctx) => {
        const { navigations, fire } = await boot({
          href: 'https://brand.test/dashboard/account',
          policy: 'authenticated',
          redirects: REDIRECTS,
        });

        await fire({ user: new User(), denied: false });

        ctx.expect(navigations).toEqual([
          'https://brand.test/signin?authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount',
        ]);
      },
    },

    {
      name: 'auth policy: signed in on an unauthenticated page bounces to the authenticated destination',
      run: async (ctx) => {
        const { navigations, fire } = await boot({
          href: 'https://brand.test/signin',
          policy: 'unauthenticated',
          redirects: REDIRECTS,
          pagePath: '/signin',
        });

        await fire({ user: new User(SETTLED_ACCOUNT, { uid: 'u1', email: 'a@b.co' }), denied: false });

        ctx.expect(navigations).toEqual(['https://brand.test/dashboard/account']);
      },
    },

    {
      name: 'auth policy: signed in on an unauthenticated page prefers authReturnUrl over the default',
      run: async (ctx) => {
        const { navigations, fire } = await boot({
          href: 'https://brand.test/signin?authReturnUrl=https%3A%2F%2Fbrand.test%2Fpricing',
          policy: 'unauthenticated',
          redirects: REDIRECTS,
          pagePath: '/signin',
        });

        await fire({ user: new User(SETTLED_ACCOUNT, { uid: 'u1' }), denied: false });

        ctx.expect(navigations).toEqual(['https://brand.test/pricing']);
      },
    },

    {
      name: 'auth policy: a signout in flight with an authReturnUrl keeps the user on the page',
      run: async (ctx) => {
        const { navigations, fire } = await boot({
          href: 'https://brand.test/dashboard/account?authSignout=true&authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount',
          policy: 'authenticated',
          redirects: REDIRECTS,
        });

        // The signout pass: still signed in, param present — sets justSignedOut.
        await fire({ user: new User(SETTLED_ACCOUNT, { uid: 'u1' }), denied: false });
        // The state change the signout produces: no kick-out, the page re-authenticates.
        await fire({ user: new User(), denied: false });

        ctx.expect(navigations).toEqual([]);
      },
    },

    {
      name: 'auth policy: the suppression is one-shot — the next signed-out state still kicks out',
      run: async (ctx) => {
        const { navigations, fire } = await boot({
          href: 'https://brand.test/dashboard/account?authSignout=true&authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount',
          policy: 'authenticated',
          redirects: REDIRECTS,
        });

        await fire({ user: new User(SETTLED_ACCOUNT, { uid: 'u1' }), denied: false });
        await fire({ user: new User(), denied: false });
        await fire({ user: new User(), denied: false });

        ctx.expect(navigations).toEqual([
          'https://brand.test/signin?authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount%3FauthSignout%3Dtrue%26authReturnUrl%3Dhttps%253A%252F%252Fbrand.test%252Fdashboard%252Faccount',
        ]);
      },
    },

    {
      name: 'auth policy: a stale signed-in state after the authSignout param is stripped keeps the page (#196)',
      run: async (ctx) => {
        const { navigations, fire } = await boot({
          href: 'https://brand.test/signin',
          policy: 'unauthenticated',
          redirects: REDIRECTS,
          pagePath: '/signin',
        });

        // What handleAuthSignout leaves behind mid-signout: the flag set, and the URL
        // already stripped of ?authSignout — so only the flag can catch the stale event.
        window.__OMEGA_SIGNOUT_IN_PROGRESS = true;

        await fire({ user: new User(SETTLED_ACCOUNT, { uid: 'u1' }), denied: false });

        ctx.expect(navigations, 'the stale signed-in event must not bounce off /signin').toEqual([]);
        ctx.expect(window.__OMEGA_SIGNOUT_IN_PROGRESS, 'the flag holds until the signed-out event lands').toBe(true);

        // The signed-out event the flag was waiting for: clears it, page stays put.
        await fire({ user: new User(), denied: false });

        ctx.expect(window.__OMEGA_SIGNOUT_IN_PROGRESS).toBe(false);
        ctx.expect(navigations).toEqual([]);
      },
    },

    {
      name: 'auth policy: the signed-out state clears the signout flag and falls through to the normal path',
      run: async (ctx) => {
        const { navigations, fire } = await boot({
          href: 'https://brand.test/dashboard/account',
          policy: 'authenticated',
          redirects: REDIRECTS,
        });

        window.__OMEGA_SIGNOUT_IN_PROGRESS = true;

        await fire({ user: new User(), denied: false });

        ctx.expect(window.__OMEGA_SIGNOUT_IN_PROGRESS).toBe(false);
        ctx.expect(navigations, 'no authReturnUrl to stay for — the authenticated page still kicks the user out').toEqual([
          'https://brand.test/signin?authReturnUrl=https%3A%2F%2Fbrand.test%2Fdashboard%2Faccount',
        ]);
      },
    },

    {
      name: 'auth policy: a signed-OUT visit to ?authSignout=true never wedges the next sign-in (#196)',
      run: async (ctx) => {
        const { navigations, fire, client, sessionParams } = await boot({
          href: 'https://brand.test/signin?authSignout=true',
          policy: 'unauthenticated',
          redirects: REDIRECTS,
          pagePath: '/signin',
        });

        // Nobody is signed in — checkout's switch-account link and the legacy reset
        // redirects both land here. signOut() changes no uid, so firebase fires NO
        // state change, so nothing would ever clear a flag set now.
        client.auth.user = new User();

        await sessionParams.handleAuthSignout();

        ctx.expect(window.__OMEGA_SIGNOUT_IN_PROGRESS, 'no state change is coming — the flag must not be set').toBe(undefined);
        ctx.expect(client.signOuts, 'the signOut still runs unconditionally').toEqual([true]);
        ctx.expect(window.location.href, 'and the param is still stripped').toBe('https://brand.test/signin');

        // The user signs in on this same page load: the policy must still bounce them.
        await fire({ user: new User(SETTLED_ACCOUNT, { uid: 'u1' }), denied: false });

        ctx.expect(navigations, 'a swallowed sign-in strands the user on /signin').toEqual(['https://brand.test/dashboard/account']);
      },
    },

    {
      name: 'auth policy: a signed-IN visit to ?authSignout=true still flags the signout for the listener',
      run: async (ctx) => {
        const { fire, client, sessionParams } = await boot({
          href: 'https://brand.test/dashboard/account?authSignout=true',
          policy: 'authenticated',
          redirects: REDIRECTS,
        });

        client.auth.user = new User({}, { uid: 'u1' });

        await sessionParams.handleAuthSignout();

        ctx.expect(window.__OMEGA_SIGNOUT_IN_PROGRESS, 'a real signout is in flight — the flag guards the stale event').toBe(true);

        // The signed-out state change the flag was waiting for clears it.
        await fire({ user: new User(), denied: false });

        ctx.expect(window.__OMEGA_SIGNOUT_IN_PROGRESS).toBe(false);
      },
    },

    // #661: an ?authCustomToken expires in an hour, so a DURABLE url (an OBS dock,
    // a kiosk, a bookmark) carries an `api.privateKey` instead — and trades it for a
    // fresh custom token at POST /omega/user/token on every load.
    {
      name: 'auth policy: ?authPrivateKey trades the key for a custom token and follows the return url (#661)',
      run: async (ctx) => {
        const signIns = [];
        const { navigations, client, sessionParams } = await boot({
          href: 'https://brand.test/signin?authPrivateKey=pk-live-abc123&authReturnUrl=%2Fdashboard%2Fstream',
          policy: 'unauthenticated',
          redirects: REDIRECTS,
          pagePath: '/signin',
          firebaseAuth: {
            getAuth: () => ({}),
            signInWithCustomToken: async (auth, token) => {
              signIns.push(token);
              return { user: { uid: 'u1', email: 'dock@brand.test' } };
            },
          },
        });

        client.answerRequests(async () => ({ token: 'minted-custom-token' }));

        const { result: handled, printed } = await captureConsole(() => sessionParams.handlePrivateKeySignin());

        ctx.expect(handled, 'the handler owns the page from here').toBe(true);
        ctx.expect(client.requests, 'the key IS the credential — sent as the Bearer, never as the signed-in ID token').toEqual([{
          url: '/omega/user/token',
          options: {
            method: 'POST',
            auth: false,
            headers: { Authorization: 'Bearer pk-live-abc123' },
          },
        }]);
        ctx.expect(signIns, 'the MINTED token signs the user in').toEqual(['minted-custom-token']);
        ctx.expect(window.location.href, 'the key is stripped from the address bar before the page moves').toBe('https://brand.test/signin?authReturnUrl=%2Fdashboard%2Fstream');
        ctx.expect(navigations).toEqual(['/dashboard/stream']);
        ctx.expect(!printed.join(' ').includes('pk-live-abc123'), 'a credential must never be printed').toBeTruthy();
      },
    },

    {
      name: 'auth policy: a rejected ?authPrivateKey strips the key and leaves the normal sign-in page (#661)',
      run: async (ctx) => {
        const signIns = [];
        const { navigations, client, sessionParams } = await boot({
          href: 'https://brand.test/signin?authPrivateKey=pk-live-revoked&authReturnUrl=%2Fdashboard%2Fstream',
          policy: 'unauthenticated',
          redirects: REDIRECTS,
          pagePath: '/signin',
          firebaseAuth: {
            getAuth: () => ({}),
            signInWithCustomToken: async (auth, token) => {
              signIns.push(token);
              return { user: { uid: 'u1' } };
            },
          },
        });

        // What the backend answers a dead key with.
        client.answerRequests(async () => {
          throw Object.assign(new Error('Authentication required'), { code: 401 });
        });

        const { result: handled, printed } = await captureConsole(() => sessionParams.handlePrivateKeySignin());

        ctx.expect(handled, 'nobody was signed in — the page keeps its own form').toBe(false);
        ctx.expect(signIns, 'a 401 never reaches firebase').toEqual([]);
        ctx.expect(window.location.href, 'the dead key is stripped either way').toBe('https://brand.test/signin?authReturnUrl=%2Fdashboard%2Fstream');
        ctx.expect(navigations, 'and the visitor stays on /signin').toEqual([]);
        ctx.expect(window.__OMEGA_CUSTOM_TOKEN_SIGNIN, 'navigation control goes back to the policy listener').toBe(false);
        ctx.expect(client.notificationsShown.length, 'the visitor is told why').toBe(1);
        ctx.expect(client.notificationsShown[0].options.type).toBe('danger');

        const reported = [
          ...printed,
          ...client.notificationsShown.map((notification) => notification.message),
          ...client.sentryCaptures.map(({ error, url }) => `${error.message} ${error.cause?.message} ${url}`),
        ].join(' ');

        ctx.expect(!reported.includes('pk-live-revoked'), 'the key must never reach a log, a notification, or Sentry').toBeTruthy();
        ctx.expect(client.sentryCaptures.every(({ url }) => !url.includes('authPrivateKey')), 'the strip runs BEFORE the capture — the url Sentry attaches carries no key').toBeTruthy();
      },
    },

    {
      name: 'auth policy: policy disabled registers no listener and never navigates',
      run: async (ctx) => {
        const { navigations, client } = await boot({
          href: 'https://brand.test/vert/iframe',
          policy: 'disabled',
          redirects: REDIRECTS,
        });

        ctx.expect(client.listeners, 'no auth listener is set up at all').toEqual([]);
        ctx.expect(navigations).toEqual([]);
      },
    },

    {
      name: 'auth policy: a signed-out visitor to a public page stays put',
      run: async (ctx) => {
        const { navigations, fire } = await boot({
          href: 'https://brand.test/pricing',
          policy: 'public',
          redirects: REDIRECTS,
          pagePath: '/pricing',
        });

        await fire({ user: new User(), denied: false });

        ctx.expect(navigations).toEqual([]);
      },
    },

    {
      name: 'auth policy: a signed-in user missing a required role is sent to the authenticated destination',
      run: async (ctx) => {
        const { navigations, fire } = await boot({
          href: 'https://brand.test/dashboard/admin',
          policy: 'authenticated',
          roles: { admin: true },
          redirects: REDIRECTS,
        });

        await fire({ user: new User(SETTLED_ACCOUNT, { uid: 'u1' }), denied: false });

        ctx.expect(navigations).toEqual(['https://brand.test/dashboard/account']);
      },
    },

    // #700: the listener used to AWAIT the signup post, so a fresh signup sat on a
    // loading page for the whole server round trip — and the await only existed to
    // order the post before a consent guard that was 100% legacy. The guard is
    // deleted, the post is fire-and-forget, and the two states it used to conflate
    // are told apart: a doc that is not written yet is NORMAL, a rules
    // permission-denied on the account read is a real failure.
    {
      name: 'auth policy: the signup post never blocks the rest of the listener (#700)',
      run: async (ctx) => {
        const { navigations, fire, client } = await boot({
          href: 'https://brand.test/dashboard/admin',
          policy: 'authenticated',
          roles: { admin: true },
          redirects: REDIRECTS,
          pagePath: '/dashboard/admin',
        });

        // A post that never answers: awaiting it would strand the listener here.
        client.blockRequests();

        await fire({ user: new User(PENDING_ACCOUNT, { uid: 'u1' }), denied: false });

        ctx.expect(client.requests.length, 'the post still goes out').toBe(1);
        ctx.expect(client.requests[0].url).toBe('/omega/user/signup');
        ctx.expect(navigations, 'and the page moves on without it').toEqual(['https://brand.test/dashboard/account']);
      },
    },

    {
      name: 'auth policy: a doc that is not written yet keeps the user signed in (#700)',
      run: async (ctx) => {
        const { navigations, fire, client } = await boot({
          href: 'https://brand.test/dashboard/account',
          policy: 'authenticated',
          redirects: REDIRECTS,
        });

        await fire({ user: new User(PENDING_ACCOUNT, { uid: 'u1' }), denied: false });

        ctx.expect(client.signOuts, 'pending is the normal state right after signup').toEqual([]);
        ctx.expect(client.notificationsShown, 'and nothing to tell the user about').toEqual([]);
        ctx.expect(navigations).toEqual([]);
      },
    },

    {
      name: 'auth policy: a processed doc with no legal consent is no longer signed out (#700)',
      run: async (ctx) => {
        const { navigations, fire, client } = await boot({
          href: 'https://brand.test/signin',
          policy: 'unauthenticated',
          redirects: REDIRECTS,
          pagePath: '/signin',
        });

        // Exactly what the deleted consent guard kicked out on.
        await fire({
          user: new User({ flags: { signupProcessed: true }, consent: { legal: { status: 'revoked' } } }, { uid: 'u1' }),
          denied: false,
        });

        ctx.expect(client.signOuts, 'the guard is gone — consent is the signup route\'s business').toEqual([]);
        ctx.expect(navigations, 'the user falls through to the policy').toEqual(['https://brand.test/dashboard/account']);
      },
    },

    {
      name: 'auth policy: a denied account read signs the user out and posts nothing (#700)',
      run: async (ctx) => {
        const { navigations, fire, client } = await boot({
          href: 'https://brand.test/dashboard/account',
          policy: 'authenticated',
          redirects: REDIRECTS,
        });

        // The one signal that means a real failure: rules refused the read.
        await fire({ user: new User(PENDING_ACCOUNT, { uid: 'u1' }), denied: true });

        ctx.expect(client.signOuts).toEqual([true]);
        ctx.expect(client.notificationsShown.length, 'the user is told, not silently bounced').toBe(1);
        ctx.expect(client.notificationsShown[0].options.type).toBe('danger');
        ctx.expect(client.requests, 'a denied read must not post signup metadata').toEqual([]);
        ctx.expect(navigations, 'the signout state change owns the navigation from here').toEqual([]);
      },
    },

    // #701: the return leg resolved getRedirectResult OUTSIDE its own try, so a
    // server-side signup rejection (the blocking function's rate limit, delivered
    // as a 503 / `auth/error-code:-47`) escaped the function entirely. The caller
    // awaits it with no catch, right after disabling the form — so the person saw
    // nothing at all: no message, and a form that never came back.
    {
      name: 'auth page: a rate-limited OAuth signup shows the reason and gives the form back (#701)',
      run: async (ctx) => {
        const { formManager } = await bootAuthPage({
          href: 'https://brand.test/signup',
          pagePath: '/signup',
          firebaseAuth: {
            getAuth: () => ({}),
            getRedirectResult: async () => {
              // What identitytoolkit's signInWithIdp 503 reaches the client as: the
              // code, and nothing else — no customData.serverResponse blob.
              throw Object.assign(new Error('Firebase: Error (auth/error-code:-47).'), {
                name: 'FirebaseError',
                code: 'auth/error-code:-47',
              });
            },
          },
        });

        ctx.expect(formManager.errors.length, 'the person is told why the signup failed').toBe(1);
        ctx.expect(formManager.errors[0]).toMatch(/^Account creation is temporarily restricted/);
        ctx.expect(formManager.calls, 'the form is handed back, not left disabled behind spinners').toEqual([
          '_setDisabled(true)',
          'showError()',
          'ready()',
        ]);
      },
    },

    {
      name: 'auth policy: the consent guard flag is gone from the source (#700)',
      run: async (ctx) => {
        // Behaviour alone cannot tell a deleted guard from one flipped to false, and
        // Ian's ruling was deletion.
        const source = fs.readFileSync(AUTH_ENTRY, 'utf8');

        ctx.expect(!source.includes('ENFORCE_CONSENT_GUARD'), 'the consent guard flag must not exist at all').toBeTruthy();
      },
    },
  ],
});
