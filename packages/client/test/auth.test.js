const defineCases = require('@omega.js/devkit/test/define-cases');
const { registerHooks } = require('node:module');
const { User } = require('@omega.js/account');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

// The Auth module under a minimal Omega stand-in: enough of the surface a state
// build touches, plus a record of every bindings/storage write so what an emission
// delivered (or dropped) is provable.
let Auth;

function createHarness() {
  const bindingsUpdates = [];
  const storageWrites = [];
  const omega = {
    config: {},
    // The saved session is restored already unless a case holds authStateReady() open
    firebaseAuth: { currentUser: null, authStateReady: async () => {} },
    // Firebase is configured (the app exists), and Firestore loads through the loader
    firebaseApp: {},
    loadFirebaseFirestore: async () => ({}),
    _resolveFirebaseConfig: () => ({ apiKey: 'test-api-key' }),
    bindings: { update: (payload) => bindingsUpdates.push(payload) },
    storage: { set: (key, value) => storageWrites.push([key, value]), get: () => ({}) },
  };

  const auth = new Auth(omega);
  const states = [];

  return { auth, omega, states, bindingsUpdates, storageWrites };
}

// Flush the microtask queue so every already-resolved await inside a state build lands
const flush = () => new Promise((resolve) => setImmediate(resolve));

module.exports = defineCases({
  type: 'group',
  description: 'auth',
  setup: async (ctx) => {
    await (createOmega)();
    await (async () => {
      Auth = (await import('../src/modules/auth.js')).default;
    })();
  },
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        await getOmega().initialize(TEST_CONFIG);
      })()));

      cases.push({
        name: 'Auth Module > should expose expected methods',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const auth = getOmega().auth;
          ctx.expect(typeof auth.listen === 'function').toBeTruthy();
          ctx.expect(typeof auth.reload === 'function').toBeTruthy();
          ctx.expect(typeof auth.signInWithEmailAndPassword === 'function').toBeTruthy();
          ctx.expect(typeof auth.signOut === 'function').toBeTruthy();
        },
      });

      cases.push({
        name: 'Auth Module > should carry no retired readers: auth.user is the one account surface',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const auth = getOmega().auth;
          ctx.expect(auth.getUser).toBe(undefined);
          ctx.expect(auth.isAuthenticated).toBe(undefined);
          ctx.expect(auth.resolveSubscription).toBe(undefined);
        },
      });

      cases.push({
        name: 'Auth Module > should hold a signed-out User before any listen',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          const user = getOmega().auth.user;
          ctx.expect(user instanceof User, 'auth.user is a User, never null').toBeTruthy();
          ctx.expect(user.authenticated).toBe(false);
          ctx.expect(user.plan).toBe('basic');
        },
      });

      cases.push({
        name: 'Auth Module > should call back { user, denied } with a signed-out User when Firebase is disabled',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          return new Promise((resolve, reject) => {
          getOmega().auth.listen((state) => {
            try {
              ctx.expect(Object.keys(state)).toEqual(['user', 'denied']);
              ctx.expect(state.denied).toBe(false);
              ctx.expect(state.user instanceof User).toBeTruthy();
              ctx.expect(state.user.authenticated).toBe(false);
              ctx.expect(state.user.plan).toBe('basic');
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });
        },
      });
      return cases;
    })(),

    // #945: `omega.auth.user` is a User built from the account document plus the
    // sign-in's identity, replaced before any callback runs, and the bindings read
    // it live under the one `auth.user` root.
    ...(() => {
      const cases = [];
      const IDENTITY = {
        uid: 'user-1',
        email: 'user@test.com',
        displayName: 'Test User',
        photoURL: 'https://example.com/me.png',
        emailVerified: true,
        providerData: [],
      };

      const PRO_DOC = { subscription: { product: { id: 'pro' }, status: 'active' } };

      cases.push({
        name: 'Auth Module: the User state (#945) > should deliver a User built from the account document and the identity, as auth.user',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, states } = createHarness();

          auth._getAccountData = async () => PRO_DOC;
          auth.listen((state) => states.push(state));

          omega.firebaseAuth.currentUser = IDENTITY;
          auth._handleAuthStateChange(IDENTITY);
          await flush();

          ctx.expect(states.length).toBe(1);
          const { user, denied } = states[0];
          ctx.expect(user instanceof User).toBeTruthy();
          ctx.expect(denied).toBe(false);
          ctx.expect(user.plan).toBe('pro');
          ctx.expect(user.active).toBe(true);
          ctx.expect(user.uid).toBe('user-1');
          ctx.expect(user.profile.displayName).toBe('Test User');
          ctx.expect(user.profile.emailVerified).toBe(true);
          ctx.expect(auth.user, 'auth.user is the very instance the callback received').toBe(user);
        },
      });

      cases.push({
        name: 'Auth Module: the User state (#945) > should hand the bindings the live User under auth.user, getters working',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, bindingsUpdates, storageWrites } = createHarness();

          auth._getAccountData = async () => PRO_DOC;
          auth.listen(() => {});

          omega.firebaseAuth.currentUser = IDENTITY;
          auth._handleAuthStateChange(IDENTITY);
          await flush();

          ctx.expect(bindingsUpdates.length).toBe(1);
          ctx.expect(Object.keys(bindingsUpdates[0].auth)).toEqual(['user']);
          ctx.expect(bindingsUpdates[0].auth.user).toBe(auth.user);
          ctx.expect(bindingsUpdates[0].auth.user.plan).toBe('pro');
          ctx.expect(bindingsUpdates[0].auth.user.email).toBe('user@test.com');

          // Storage serializes the User to its stored document, so the persisted
          // identity sits under the document's `auth` branch (what sentry reads)
          const stored = JSON.parse(JSON.stringify(storageWrites[0][1]));
          ctx.expect(stored.user.auth.uid).toBe('user-1');
          ctx.expect(stored.user.auth.email).toBe('user@test.com');
          ctx.expect(stored.denied).toBe(false);
        },
      });

      cases.push({
        name: 'Auth Module: the User state (#945) > should enrich a missing displayName and photoURL from the provider entries',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth } = createHarness();

          const identity = auth._identity({
            uid: 'user-1',
            email: 'user@test.com',
            displayName: null,
            photoURL: null,
            providerData: [{ displayName: 'Provider Name', photoURL: 'https://example.com/p.png' }],
          });

          ctx.expect(identity).toEqual({
            uid: 'user-1',
            email: 'user@test.com',
            displayName: 'Provider Name',
            photoURL: 'https://example.com/p.png',
            emailVerified: false,
          });
          ctx.expect(auth._identity(null)).toBe(null);
        },
      });
      return cases;
    })(),

    // #196: a signed-in emission awaits the account fetch, a signed-out one fires
    // instantly — so a slow fetch could deliver a STALE signed-in state after a
    // newer signed-out one and make consumers redirect a signed-out page.
    ...(() => {
      const cases = [];
      const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };
      const PREMIUM_DOC = { subscription: { product: { id: 'premium' }, status: 'active' } };

      cases.push({
        name: 'Auth Module — auth state emission ordering (#196) > should drop a stale signed-in emission superseded by a signed-out one',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, states, bindingsUpdates, storageWrites } = createHarness();

          // Account fetch we control: the signed-in emission hangs on it
          let resolveAccountFetch;
          auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });

          auth.listen((state) => states.push(state));

          // Signed-in state change — starts the account fetch and blocks there
          omega.firebaseAuth.currentUser = USER;
          auth._handleAuthStateChange(USER);
          await flush();
          ctx.expect(states.length).toBe(0);

          // Signed-out state change — no fetch, so it delivers immediately
          omega.firebaseAuth.currentUser = null;
          auth._handleAuthStateChange(null);
          await flush();
          ctx.expect(states.length).toBe(1);
          ctx.expect(states[0].user.authenticated).toBe(false);

          // The stale fetch finally resolves — its emission must be dropped
          resolveAccountFetch(PREMIUM_DOC);
          await flush();

          ctx.expect(states.length).toBe(1);
          ctx.expect(states[states.length - 1].user.authenticated).toBe(false);
          ctx.expect(auth.user.authenticated, 'the dropped emission never replaced auth.user').toBe(false);
          ctx.expect(bindingsUpdates.length).toBe(1);
          ctx.expect(bindingsUpdates[0].auth.user.authenticated).toBe(false);
          ctx.expect(storageWrites.length).toBe(1);
          ctx.expect(storageWrites[0][1].user.authenticated).toBe(false);
        },
      });

      cases.push({
        name: 'Auth Module — auth state emission ordering (#196) > should still deliver a signed-in emission when no newer state supersedes it',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, states } = createHarness();

          let resolveAccountFetch;
          auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });

          auth.listen((state) => states.push(state));

          omega.firebaseAuth.currentUser = USER;
          auth._handleAuthStateChange(USER);
          await flush();
          ctx.expect(states.length).toBe(0);

          resolveAccountFetch(PREMIUM_DOC);
          await flush();

          ctx.expect(states.length).toBe(1);
          ctx.expect(states[0].user.uid).toBe('user-1');
          ctx.expect(states[0].user.plan).toBe('premium');
        },
      });

      cases.push({
        name: 'Auth Module — auth state emission ordering (#196) > should settle a once listener with the NEWEST state when its first build is superseded',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, states } = createHarness();

          let resolveAccountFetch;
          auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });

          // A once listener waiting on the first state, which blocks on the fetch
          auth.listen({ once: true }, (state) => states.push(state));

          omega.firebaseAuth.currentUser = USER;
          auth._handleAuthStateChange(USER);
          await flush();
          ctx.expect(states.length).toBe(0);

          // A signed-out change supersedes the build: it is the first state to land,
          // so it settles the once listener (checkout boot and the extension auth
          // helpers await exactly this)
          omega.firebaseAuth.currentUser = null;
          auth._handleAuthStateChange(null);
          await flush();

          resolveAccountFetch(PREMIUM_DOC);
          await flush();

          ctx.expect(states.length, 'the once listener must still fire, exactly once').toBe(1);
          ctx.expect(states[0].user.authenticated, 'and with the NEWEST state, not the stale one').toBe(false);
        },
      });
      return cases;
    })(),

    // #945: ONE `User` per auth state change, built once before anything reads it,
    // and every consumer (persistent listeners, once listeners, `auth.user`, the
    // bindings) holds that same instance.
    ...(() => {
      const cases = [];
      const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };
      const PRO_DOC = { subscription: { product: { id: 'pro' }, status: 'active' } };

      cases.push({
        name: 'Auth Module: one state build per change (#945) > should fetch the account once and hand every listener the same User',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, bindingsUpdates, storageWrites } = createHarness();

          let fetches = 0;
          auth._getAccountData = async () => { fetches++; return PRO_DOC; };

          const first = [];
          const second = [];
          const once = [];
          auth.listen((state) => first.push(state));
          auth.listen((state) => second.push(state));
          auth.listen({ once: true }, (state) => once.push(state));

          omega.firebaseAuth.currentUser = USER;
          auth._handleAuthStateChange(USER);
          await flush();

          ctx.expect(fetches, 'one account fetch per auth state change, however many listen').toBe(1);
          ctx.expect(first.length).toBe(1);
          ctx.expect(second.length).toBe(1);
          ctx.expect(once.length).toBe(1);
          ctx.expect(first[0].user.plan).toBe('pro');
          ctx.expect(second[0].user, 'both persistent listeners hold the same User').toBe(first[0].user);
          ctx.expect(once[0].user, 'the once listener holds it too').toBe(first[0].user);
          ctx.expect(auth.user, 'and it is auth.user').toBe(first[0].user);
          ctx.expect(bindingsUpdates.length, 'the bindings update once').toBe(1);
          ctx.expect(bindingsUpdates[0].auth.user).toBe(auth.user);
          ctx.expect(storageWrites.length, 'the storage writes once').toBe(1);
        },
      });

      cases.push({
        name: 'Auth Module: one state build per change (#945) > should catch a late persistent listener up with the landed state, once and asynchronously',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega } = createHarness();

          let fetches = 0;
          auth._getAccountData = async () => { fetches++; return PRO_DOC; };

          omega.firebaseAuth.currentUser = USER;
          auth._handleAuthStateChange(USER);
          await flush();

          const late = [];
          auth.listen((state) => late.push(state));
          ctx.expect(late.length, 'the catch-up never runs inside listen()').toBe(0);

          await flush();

          ctx.expect(late.length, 'the late listener hears the landed state once').toBe(1);
          ctx.expect(late[0]).toBe(auth.state);
          ctx.expect(late[0].user).toBe(auth.user);
          ctx.expect(fetches, 'catching up builds nothing new').toBe(1);
        },
      });

      cases.push({
        name: 'Auth Module: one state build per change (#945) > should settle a once listener with the first landed state, and a later one with the newest',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega } = createHarness();

          auth._getAccountData = async () => PRO_DOC;

          // Registered before anything landed: settles on the first state
          const early = [];
          auth.listen({ once: true }, (state) => early.push(state));

          omega.firebaseAuth.currentUser = USER;
          auth._handleAuthStateChange(USER);
          await flush();

          ctx.expect(early.length).toBe(1);
          ctx.expect(early[0].user.uid).toBe('user-1');

          // A second state lands; a once listener registered after it gets that one
          omega.firebaseAuth.currentUser = null;
          auth._handleAuthStateChange(null);
          await flush();

          const later = [];
          auth.listen({ once: true }, (state) => later.push(state));
          await flush();

          ctx.expect(early.length, 'the early once listener never fires again').toBe(1);
          ctx.expect(later.length).toBe(1);
          ctx.expect(later[0], 'the newest landed state').toBe(auth.state);
          ctx.expect(later[0].user.authenticated).toBe(false);
        },
      });
      return cases;
    })(),

    // #945: a page that wrote something the backend lands (a purchase, a cancel)
    // re-reads the account through `omega.auth.reload()`: the same build as an auth
    // state change, so the bindings, the storage and every listener move with it.
    ...(() => {
      const cases = [];
      const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };
      const PRO_DOC = { subscription: { product: { id: 'pro' }, status: 'active' } };

      cases.push({
        name: 'Auth Module: reload() re-reads the account (#945) > should rebuild auth.user from a fresh fetch and deliver it to every persistent listener',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, states, bindingsUpdates, storageWrites } = createHarness();

          auth._getAccountData = async () => ({});
          auth.listen((state) => states.push(state));

          omega.firebaseAuth.currentUser = USER;
          auth._handleAuthStateChange(USER);
          await flush();

          ctx.expect(states.length).toBe(1);
          ctx.expect(states[0].user.plan).toBe('basic');

          // The webhook landed the purchase
          auth._getAccountData = async () => PRO_DOC;
          const state = await auth.reload();

          ctx.expect(state.user.plan).toBe('pro');
          ctx.expect(state.denied).toBe(false);
          ctx.expect(state, 'reload resolves with the landed state').toBe(auth.state);
          ctx.expect(auth.user, 'auth.user is the rebuilt instance').toBe(state.user);
          ctx.expect(states.length, 'every persistent listener hears the reload once more').toBe(2);
          ctx.expect(states[1]).toBe(state);
          ctx.expect(bindingsUpdates.length).toBe(2);
          ctx.expect(bindingsUpdates[1].auth.user, 'the bindings read the rebuilt User').toBe(state.user);
          ctx.expect(storageWrites.length).toBe(2);
          ctx.expect(storageWrites[1][1], 'the storage holds the rebuilt state').toBe(state);
        },
      });

      cases.push({
        name: 'Auth Module: reload() re-reads the account (#945) > should land a signed-out User when no Firebase user is signed in',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, states } = createHarness();

          let fetches = 0;
          auth._getAccountData = async () => { fetches++; return PRO_DOC; };
          auth.listen((state) => states.push(state));

          const state = await auth.reload();

          ctx.expect(state.user instanceof User).toBeTruthy();
          ctx.expect(state.user.authenticated).toBe(false);
          ctx.expect(auth.user).toBe(state.user);
          ctx.expect(fetches, 'a signed-out reload fetches nothing').toBe(0);
          ctx.expect(states.length).toBe(1);
        },
      });

      cases.push({
        name: 'Auth Module: reload() re-reads the account (#945) > should resolve with the newer landed state when a state change supersedes it mid-fetch',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, states } = createHarness();

          // Account fetch we control: the reload hangs on it
          let resolveAccountFetch;
          auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });
          auth.listen((state) => states.push(state));

          omega.firebaseAuth.currentUser = USER;
          const reloading = auth.reload();
          await flush();
          ctx.expect(states.length).toBe(0);

          // A sign-out lands while the reload is still fetching
          omega.firebaseAuth.currentUser = null;
          auth._handleAuthStateChange(null);
          await flush();

          resolveAccountFetch(PRO_DOC);
          const state = await reloading;

          ctx.expect(state.user.authenticated, 'the reload resolves with the newer state').toBe(false);
          ctx.expect(state).toBe(auth.state);
          ctx.expect(states.length, 'the stale reload is never delivered').toBe(1);
          ctx.expect(states[0]).toBe(state);
          ctx.expect(auth.user.authenticated, 'and it never replaced auth.user').toBe(false);
        },
      });

      cases.push({
        name: 'Auth Module: reload() re-reads the account (#945) > should follow a superseding build that is itself still fetching',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, states } = createHarness();

          const fetches = [];
          auth._getAccountData = () => new Promise((resolve) => fetches.push(resolve));
          auth.listen((state) => states.push(state));

          omega.firebaseAuth.currentUser = USER;
          const reloading = auth.reload();
          await flush();

          // A newer signed-in change starts its own fetch before the reload's returns
          auth._handleAuthStateChange(USER);
          await flush();
          ctx.expect(fetches.length).toBe(2);

          let settled = false;
          reloading.then(() => { settled = true; });

          fetches[0]({});
          await flush();
          ctx.expect(settled, 'the superseded reload waits for the newer build').toBe(false);

          fetches[1](PRO_DOC);
          const state = await reloading;

          ctx.expect(state.user.plan, 'and resolves with what that build landed').toBe('pro');
          ctx.expect(states.length).toBe(1);
          ctx.expect(states[0]).toBe(state);
        },
      });
      return cases;
    })(),

    // Right after a page load Firebase is still restoring the saved session, so
    // `currentUser` reads null until `authStateReady()` resolves; a reload() called
    // then must wait for the restored user, never land a signed-out state.
    ...(() => {
      const cases = [];
      const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };
      const PRO_DOC = { subscription: { product: { id: 'pro' }, status: 'active' } };

      cases.push({
        name: 'Auth Module: reload() waits for the session restore > should land nothing until the restore settles, then resolve with the restored user',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega, states } = createHarness();

          let fetches = 0;
          auth._getAccountData = async () => { fetches++; return PRO_DOC; };
          auth.listen((state) => states.push(state));

          // The restore we control: still pending, no current user yet
          let finishRestore;
          omega.firebaseAuth.authStateReady = () => new Promise((resolve) => { finishRestore = resolve; });
          const before = auth.state;

          let settled = false;
          const reloading = auth.reload();
          reloading.then(() => { settled = true; });
          await flush();

          ctx.expect(settled, 'reload() waits on the restore').toBe(false);
          ctx.expect(states.length, 'no state lands while the restore is pending').toBe(0);
          ctx.expect(auth.state, 'auth.state is untouched').toBe(before);

          omega.firebaseAuth.currentUser = USER;
          finishRestore();
          const state = await reloading;

          ctx.expect(state.user.uid).toBe('user-1');
          ctx.expect(state.user.authenticated).toBe(true);
          ctx.expect(fetches, 'the restored user\'s account is fetched once').toBe(1);
        },
      });

      cases.push({
        name: 'Auth Module: reload() waits for the session restore > should resolve signed out and fetch nothing with no Firebase auth',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega } = createHarness();

          let fetches = 0;
          auth._getAccountData = async () => { fetches++; return PRO_DOC; };
          delete omega.firebaseAuth;

          const state = await auth.reload();

          ctx.expect(state.user instanceof User).toBeTruthy();
          ctx.expect(state.user.authenticated).toBe(false);
          ctx.expect(fetches).toBe(0);
        },
      });

      cases.push({
        name: 'Auth Module: reload() waits for the session restore > should resolve with the current user once the restore has already settled',
        run: async (ctx) => {
          await beforeEachHook();
          const { auth, omega } = createHarness();

          let fetches = 0;
          auth._getAccountData = async () => { fetches++; return PRO_DOC; };
          omega.firebaseAuth.currentUser = USER;

          const state = await auth.reload();

          ctx.expect(state.user.uid).toBe('user-1');
          ctx.expect(state.user.authenticated).toBe(true);
          ctx.expect(fetches).toBe(1);
        },
      });
      return cases;
    })(),

    // #700: a doc that is not written yet is the NORMAL state for the seconds after
    // a signup, and a rules permission-denied on the account read is a real
    // failure. Consumers branch on the SIGNAL (`state.denied`), never on the
    // account being empty, since the web listener's deleted consent guard collapsed the
    // two and signed fresh signups out.
    ...(() => {
      const cases = [];
      const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };
      const PREMIUM_DOC = { subscription: { product: { id: 'premium' }, status: 'active' } };

      // `_getAccountData` imports firebase/firestore lazily, so the seam is the
      // module resolution itself: a synchronous hook swaps that ONE specifier for a
      // stub reading `globalThis.__omegaFirestore`. Scoped to this file — node's
      // runner gives each test file its own process, and nothing else here imports
      // firestore (the suite runs with firebase disabled).
      const FIRESTORE_STUB_URL = 'omega-test-stub:firebase-firestore';

      const stubFirestoreModule = () => registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === 'firebase/firestore') {
            return { url: FIRESTORE_STUB_URL, shortCircuit: true };
          }

          return nextResolve(specifier, context);
        },
        load(url, context, nextLoad) {
          if (url === FIRESTORE_STUB_URL) {
            return {
              format: 'module',
              shortCircuit: true,
              source: `export const doc = (...args) => globalThis.__omegaFirestore.doc(...args);
                   export const getDoc = (...args) => globalThis.__omegaFirestore.getDoc(...args);`,
            };
          }

          return nextLoad(url, context);
        },
      });

      /** Point the stubbed firestore at one outcome for the next read. */
      function firestoreReturns(getDoc) {
        globalThis.__omegaFirestore = {
          doc: (db, collection, uid) => ({ collection, uid }),
          getDoc,
        };
      }

      // Minimal Omega stand-in, same shape as the shared harness above plus the
      // sentry seam _getAccountData's catch reaches for.
      function createHarness() {
        const captured = [];
        const omega = {
          config: {},
          firebaseAuth: { currentUser: null },
          // Firebase is configured (the app exists), and Firestore loads through the loader
          firebaseApp: {},
          loadFirebaseFirestore: async () => ({}),
          _resolveFirebaseConfig: () => ({ apiKey: 'test-api-key' }),
          bindings: { update: () => {} },
          storage: { set: () => {}, get: () => ({}) },
          sentry: { captureException: (error) => captured.push(error) },
        };

        return { auth: new Auth(omega), omega, captured };
      }

      const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

      let beforeHook2Run;
      const beforeHook2 = (ctx) => (beforeHook2Run ||= Promise.resolve().then(() => (() => {
        // Registered here, not at load: hooks route every later require through the
        // ESM loader, and the shared Omega import above pulls in CJS that will not
        // survive the trip.
        stubFirestoreModule();
      })()));

      cases.push({
        name: 'Auth Module — pending vs denied account reads (#700) > should return an empty document when the doc is not written yet',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const { auth } = createHarness();

          firestoreReturns(async () => ({ exists: () => false }));

          const document = await auth._getAccountData('user-1');

          ctx.expect(document, 'a missing doc is pending, not a failure: the User resolves it to the empty shape').toEqual({});
        },
      });

      cases.push({
        name: 'Auth Module — pending vs denied account reads (#700) > should return the raw stored document, leaving resolution to the User',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const { auth } = createHarness();

          firestoreReturns(async () => ({ exists: () => true, data: () => PREMIUM_DOC }));

          ctx.expect(await auth._getAccountData('user-1')).toBe(PREMIUM_DOC);
        },
      });

      cases.push({
        name: 'Auth Module — pending vs denied account reads (#700) > should rethrow a permission-denied read so the caller can tell it from pending',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const { auth, captured } = createHarness();

          firestoreReturns(async () => { throw denied(); });

          await ctx.expect(auth._getAccountData('user-1')).rejects.toThrow({ code: 'permission-denied' });
          ctx.expect(captured.length, 'and it still reaches monitoring').toBe(1);
        },
      });

      cases.push({
        name: 'Auth Module — pending vs denied account reads (#700) > should deliver denied on a permission-denied read, with a signed-in User still built',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const { auth, omega } = createHarness();
          const states = [];

          firestoreReturns(async () => { throw denied(); });

          auth.listen((state) => states.push(state));

          omega.firebaseAuth.currentUser = USER;
          auth._handleAuthStateChange(USER);
          await flush();

          ctx.expect(states.length).toBe(1);
          ctx.expect(states[0].denied).toBe(true);
          ctx.expect(states[0].user instanceof User).toBeTruthy();
          ctx.expect(states[0].user.authenticated).toBe(true);
          ctx.expect(states[0].user.uid, 'the identity still lands, so nothing downstream null-checks').toBe('user-1');
          ctx.expect(states[0].user.plan).toBe('basic');
        },
      });

      cases.push({
        name: 'Auth Module — pending vs denied account reads (#700) > should degrade a non-permission failure to the empty account with denied false',
        run: async (ctx) => {
          await beforeHook2(ctx);
          await beforeEachHook();
          const { auth, omega, captured } = createHarness();
          const states = [];

          firestoreReturns(async () => { throw new Error('network request failed'); });

          auth.listen((state) => states.push(state));

          omega.firebaseAuth.currentUser = USER;
          auth._handleAuthStateChange(USER);
          await flush();

          ctx.expect(states.length).toBe(1);
          ctx.expect(states[0].denied, 'a transient failure is not a denial').toBe(false);
          ctx.expect(states[0].user.uid).toBe('user-1');
          ctx.expect(captured.length).toBe(1);
        },
      });
      return cases;
    })(),
  ],
});
