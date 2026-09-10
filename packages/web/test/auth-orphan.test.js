/**
 * The failed-delete orphan backstop (`core/js/libs/auth/orphan.js`) — the three
 * halves of one mechanism, driven as the real modules
 * ([#703](https://github.com/Omega-JS-Stack/omega/issues/703)):
 *
 *   - `libs/auth/oauth.js` MARKS the uid when the reversal's .delete() fails,
 *   - `core/auth.js` RETRIES the delete at auth-ready on a later visit,
 *   - `libs/auth/forms.js` CLEARS the marker the moment a signup captures consent.
 *
 * The marker is the whole false-positive gate: an orphan is indistinguishable
 * from a legitimate account from the outside (a self-read is always allowed, and
 * every account is consent-less for the seconds between signup and the
 * /user/signup post landing), so the ONLY thing that knows is the browser that
 * failed the delete. The suites' convention (auth-policy.test.js,
 * auth-oauth.test.js): the REAL modules through esbuild behind the two bundler
 * aliases, the shared @firebase/auth stub, and window hand-rolled to the minimum
 * the modules touch. The client's storage is the real lodash-path store, since
 * the marker's namespace clear is a lodash-path behavior.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const lodash = require('lodash');
const { firebaseAuthStub } = require('./lib/firebase-auth-stub.js');

const CORE_DIR = path.join(__dirname, '..', 'core');
const AUTH_ENTRY = path.join(CORE_DIR, 'js', 'core', 'auth.js');
const OAUTH_ENTRY = path.join(CORE_DIR, 'js', 'libs', 'auth', 'oauth.js');
const AUTH_PAGES_ENTRY = path.join(CORE_DIR, 'js', 'libs', 'auth', 'index.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-auth-orphan-'));
const AUTH_BUNDLE = path.join(BUNDLE_DIR, 'auth.cjs');
const OAUTH_BUNDLE = path.join(BUNDLE_DIR, 'oauth.cjs');
const AUTH_PAGES_BUNDLE = path.join(BUNDLE_DIR, 'auth-pages.cjs');

// The real FormManager wants a live DOM; the pages boot gets the same
// globalThis-seam treatment the client stub gets.
const FORM_MANAGER_STUB = {
  filter: /^@omega\.js\/client\/modules\/form-manager\.js$/,
  contents: 'export const FormManager = function (...args) { return globalThis.__makeFormManager(...args); };',
};

let building = null;

function bundleModule(entryPoint, outfile, stubs) {
  return esbuild.build({
    entryPoints: [entryPoint],
    outfile,
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
    // The retry imports the SDK lazily for the ONE thing the client's user
    // projection cannot do: delete itself.
    bundleModule(AUTH_ENTRY, AUTH_BUNDLE, [firebaseAuthStub()]),
    bundleModule(OAUTH_ENTRY, OAUTH_BUNDLE, [firebaseAuthStub()]),
    bundleModule(AUTH_PAGES_ENTRY, AUTH_PAGES_BUNDLE, [firebaseAuthStub(), FORM_MANAGER_STUB]),
  ]);

  return building;
}

/** The client's storage, for real: lodash paths, so a namespace clear behaves. */
function makeStorage(initial = {}) {
  const data = lodash.cloneDeep(initial);

  return {
    data,
    get: (path, fallback) => lodash.get(data, path, fallback),
    set: (path, value) => lodash.set(data, path, value),
    remove: (path) => lodash.unset(data, path),
  };
}

/** The minimum client the modules reach for, plus everything they record. */
function makeClient({ policy = 'authenticated', storage = makeStorage() } = {}) {
  const signOuts = [];
  const requests = [];
  const notificationsShown = [];
  const sentryCaptures = [];

  const client = {
    storageState: storage,
    signOuts,
    requests,
    notificationsShown,
    sentryCaptures,
    config: {
      auth: { config: { policy, roles: null, redirects: { authenticated: '/dashboard/account', unauthenticated: '/signin' } } },
      analytics: {},
    },
    auth: () => ({
      listen: (options, handler) => client.listeners.push(handler),
      signOut: async () => signOuts.push(true),
      isAuthenticated: () => false,
    }),
    listeners: [],
    dom: () => ({ ready: async () => {} }),
    isDevelopment: () => false,
    isValidRedirectUrl: () => true,
    notifications: () => ({ subscribe: async () => {} }),
    sentry: () => ({ captureException: (error) => sentryCaptures.push(error.message) }),
    utilities: () => ({
      showNotification: (message, options) => notificationsShown.push({ message, options }),
      getContext: () => ({}),
    }),
    storage: () => storage,
    request: async (url, options) => {
      requests.push({ url, options });

      return {};
    },
  };

  return client;
}

/** The minimum browser the modules touch; returns the navigation log. */
function makeBrowser({ href = 'https://brand.test/dashboard/account', pagePath = '/dashboard/account' } = {}) {
  const navigations = [];

  globalThis.window = {
    location: {
      get href() { return href; },
      set href(value) { navigations.push(String(value)); },
      get origin() { return new URL(href).origin; },
      get hostname() { return new URL(href).hostname; },
      get pathname() { return new URL(href).pathname; },
    },
    history: { replaceState: (state, title, url) => { href = String(url); } },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  globalThis.window.top = globalThis.window;

  globalThis.document = {
    title: 'test',
    documentElement: { getAttribute: (name) => (name === 'data-page-path' ? pagePath : null) },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
  };

  globalThis.gtag = () => {};
  globalThis.fbq = () => {};
  globalThis.ttq = { identify: () => {} };

  return navigations;
}

/** Boot the REAL policy listener (the retry's call site) on one page. */
async function bootPolicy({ href, pagePath, policy, storage, firebaseAuth }) {
  await bundleOnce();

  const client = makeClient({ policy, storage });
  const navigations = makeBrowser({ href, pagePath });

  globalThis.__omegaClient = client;
  globalThis.__firebaseAuth = firebaseAuth;
  // require.resolve, not the path: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(AUTH_BUNDLE)];
  require(AUTH_BUNDLE).default();

  return { client, navigations, fire: (state) => client.listeners[0](state) };
}

// A live orphan as the listener sees it: signed in, and consent-less because the
// account was never signed up for.
const ORPHAN_UID = 'orphan-uid';
const ORPHAN_ACCOUNT = { flags: { signupProcessed: false }, consent: {} };
const MARKED = { temporary: { orphanedAccount: { [ORPHAN_UID]: 1756600000000 } } };

/** The SDK as the retry finds it: a deletable current user. */
function makeFirebaseAuth({ uid = ORPHAN_UID, deleteFails = false } = {}) {
  const deletes = [];
  const signOuts = [];
  const auth = {
    currentUser: {
      uid,
      delete: async () => {
        deletes.push(uid);

        if (deleteFails) {
          throw new Error('network down');
        }
      },
    },
  };

  return {
    deletes,
    signOuts,
    getAuth: () => auth,
    signOut: async () => signOuts.push(true),
  };
}

test('orphan: a marked account is deleted on return, and the marker is dropped (#703)', async () => {
  const storage = makeStorage(MARKED);
  const firebaseAuth = makeFirebaseAuth();
  const { client, navigations, fire } = await bootPolicy({
    href: 'https://brand.test/dashboard/account',
    policy: 'authenticated',
    storage,
    firebaseAuth,
  });

  await fire({ user: { uid: ORPHAN_UID }, account: ORPHAN_ACCOUNT });

  assert.deepStrictEqual(firebaseAuth.deletes, [ORPHAN_UID], 'the reversal that failed is re-attempted');
  assert.strictEqual(storage.get(`temporary.orphanedAccount.${ORPHAN_UID}`, null), null, 'a cleaned-up orphan is not marked any more');
  assert.deepStrictEqual(client.requests, [], 'an orphan must not post signup metadata');
  assert.deepStrictEqual(navigations, [], 'the delete signs the user out — the state change owns the page from here');
  assert.strictEqual(client.notificationsShown.length, 1, 'the user is told why they are not signed in');
});

test('orphan: a second delete failure signs the user out and reports it, marker held (#703)', async () => {
  const storage = makeStorage(MARKED);
  const firebaseAuth = makeFirebaseAuth({ deleteFails: true });
  const { client, navigations, fire } = await bootPolicy({
    href: 'https://brand.test/dashboard/account',
    policy: 'authenticated',
    storage,
    firebaseAuth,
  });

  await fire({ user: { uid: ORPHAN_UID }, account: ORPHAN_ACCOUNT });

  assert.deepStrictEqual(firebaseAuth.signOuts, [true], 'the old backstop\'s effect: the orphan does not stay signed in');
  assert.strictEqual(client.sentryCaptures.length, 1, 'a delete that failed twice is worth a report');
  assert.strictEqual(client.notificationsShown[0].options.type, 'danger');
  assert.strictEqual(
    storage.get(`temporary.orphanedAccount.${ORPHAN_UID}`, null),
    1756600000000,
    'the marker holds — the next visit tries again'
  );
  assert.deepStrictEqual(client.requests, [], 'an orphan must not post signup metadata');
  assert.deepStrictEqual(navigations, []);
});

test('orphan: an unmarked mid-signup user is never touched (#703)', async () => {
  const storage = makeStorage();
  const firebaseAuth = makeFirebaseAuth({ uid: 'fresh-uid' });
  const { client, fire } = await bootPolicy({
    href: 'https://brand.test/dashboard/account',
    policy: 'authenticated',
    storage,
    firebaseAuth,
  });

  // The seconds after a legitimate signup: consent-less doc, post still to come.
  await fire({ user: { uid: 'fresh-uid' }, account: { flags: { signupProcessed: false }, consent: {} } });

  assert.deepStrictEqual(firebaseAuth.deletes, [], 'no marker, no delete — this is the normal post-signup state');
  assert.deepStrictEqual(firebaseAuth.signOuts, []);
  assert.deepStrictEqual(client.signOuts, []);
  assert.deepStrictEqual(client.notificationsShown, []);
  assert.strictEqual(client.requests.length, 1, 'the signup metadata post still goes out');
});

test('orphan: a marked account that HAS legal consent is left alone and unmarked (#703)', async () => {
  const storage = makeStorage(MARKED);
  const firebaseAuth = makeFirebaseAuth();
  const { client, fire } = await bootPolicy({
    href: 'https://brand.test/dashboard/account',
    policy: 'authenticated',
    storage,
    firebaseAuth,
  });

  // Signed up for real since (on another device, say): consent on record wins
  // over any marker this browser is holding.
  await fire({
    user: { uid: ORPHAN_UID },
    account: { flags: { signupProcessed: true }, consent: { legal: { status: 'granted' } } },
  });

  assert.deepStrictEqual(firebaseAuth.deletes, [], 'a consented account is somebody\'s real account');
  assert.deepStrictEqual(client.signOuts, []);
  assert.strictEqual(storage.get(`temporary.orphanedAccount.${ORPHAN_UID}`, null), null, 'the stale marker is dropped');
});

test('orphan: a reversal whose delete fails marks the uid for the next visit (#703)', async () => {
  await bundleOnce();

  const storage = makeStorage();
  const client = makeClient({ storage });
  makeBrowser({ href: 'https://brand.test/signin', pagePath: '/signin' });

  globalThis.__omegaClient = client;
  globalThis.__firebaseAuth = { getAuth: () => ({}), signOut: async () => {} };
  delete require.cache[require.resolve(OAUTH_BUNDLE)];

  const formManager = { showError: () => {}, ready: () => {} };
  await require(OAUTH_BUNDLE).reverseAccidentalSignup({ formManager }, {
    uid: ORPHAN_UID,
    delete: async () => { throw new Error('network down'); },
  });

  assert.ok(storage.get(`temporary.orphanedAccount.${ORPHAN_UID}`, null), 'the browser that failed the delete is the only thing that knows');
  assert.strictEqual(client.sentryCaptures.length, 1, 'the failure is still reported');
});

test('orphan: a reversal that deletes cleanly marks nothing (#703)', async () => {
  await bundleOnce();

  const storage = makeStorage();
  const client = makeClient({ storage });
  makeBrowser({ href: 'https://brand.test/signin', pagePath: '/signin' });

  globalThis.__omegaClient = client;
  globalThis.__firebaseAuth = { getAuth: () => ({}), signOut: async () => {} };
  delete require.cache[require.resolve(OAUTH_BUNDLE)];

  const formManager = { showError: () => {}, ready: () => {} };
  await require(OAUTH_BUNDLE).reverseAccidentalSignup({ formManager }, {
    uid: ORPHAN_UID,
    delete: async () => {},
  });

  assert.strictEqual(storage.get(`temporary.orphanedAccount.${ORPHAN_UID}`, null), null, 'nothing survived to clean up');
});

test('orphan: a deliberate signup clears the markers before the account is touched (#703)', async () => {
  await bundleOnce();

  const storage = makeStorage(MARKED);
  const client = makeClient({ policy: 'unauthenticated', storage });
  makeBrowser({ href: 'https://brand.test/signup', pagePath: '/signup' });

  const handlers = {};
  const formManager = {
    $form: { addEventListener: () => {}, querySelectorAll: () => [] },
    on: (event, handler) => { handlers[event] = handler; },
    ready: () => {},
    _setDisabled: () => {},
    showError: () => {},
    showSuccess: () => {},
  };

  globalThis.__omegaClient = client;
  globalThis.__firebaseAuth = {
    getAuth: () => ({}),
    getRedirectResult: async () => null,
    signInWithRedirect: async () => {},
  };
  globalThis.__makeFormManager = () => formManager;
  delete require.cache[require.resolve(AUTH_PAGES_BUNDLE)];
  require(AUTH_PAGES_BUNDLE).default();

  // The boot is a promise chain off dom().ready() with nothing to await out here.
  await new Promise((resolve) => setTimeout(resolve, 50));

  // The signup submit: consent ticked, Google pressed.
  await handlers.submit({
    data: { consentLegal: true, consentMarketing: false },
    $submitButton: { getAttribute: () => 'google.com' },
  });

  assert.strictEqual(
    storage.get(`temporary.orphanedAccount.${ORPHAN_UID}`, null),
    null,
    'a user consenting to an account must never be deleted by the backstop'
  );
  assert.strictEqual(storage.get('consent.legal.granted', null), true, 'and the consent stash still happens');
});
