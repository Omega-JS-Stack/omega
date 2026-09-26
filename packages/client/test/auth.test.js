const { describe, it, before } = require('node:test');
const { registerHooks } = require('node:module');
const { User } = require('@omega.js/account');
const { getOmega, TEST_CONFIG, assert } = require('./helpers.js');

describe('Auth Module', () => {

  before(async () => {
    await getOmega().initialize(TEST_CONFIG);
  });

  it('should expose expected methods', () => {
    const auth = getOmega().auth;
    assert(typeof auth.listen === 'function');
    assert(typeof auth.reload === 'function');
    assert(typeof auth.signInWithEmailAndPassword === 'function');
    assert(typeof auth.signOut === 'function');
  });

  it('should carry no retired readers: auth.user is the one account surface', () => {
    const auth = getOmega().auth;
    assert.strictEqual(auth.getUser, undefined);
    assert.strictEqual(auth.isAuthenticated, undefined);
    assert.strictEqual(auth.resolveSubscription, undefined);
  });

  it('should hold a signed-out User before any listen', () => {
    const user = getOmega().auth.user;
    assert(user instanceof User, 'auth.user is a User, never null');
    assert.strictEqual(user.authenticated, false);
    assert.strictEqual(user.plan, 'basic');
  });

  it('should call back { user, denied } with a signed-out User when Firebase is disabled', () => new Promise((resolve, reject) => {
    getOmega().auth.listen((state) => {
      try {
        assert.deepStrictEqual(Object.keys(state), ['user', 'denied']);
        assert.strictEqual(state.denied, false);
        assert(state.user instanceof User);
        assert.strictEqual(state.user.authenticated, false);
        assert.strictEqual(state.user.plan, 'basic');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }));
});

// The Auth module under a minimal Omega stand-in: enough of the surface a state
// build touches, plus a record of every bindings/storage write so what an emission
// delivered (or dropped) is provable.
let Auth;

before(async () => {
  Auth = (await import('../src/modules/auth.js')).default;
});

function createHarness() {
  const bindingsUpdates = [];
  const storageWrites = [];
  const omega = {
    config: {},
    firebaseAuth: { currentUser: null },
    firebaseFirestore: {},
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

// #945: `omega.auth.user` is a User built from the account document plus the
// sign-in's identity, replaced before any callback runs, and the bindings read
// it live under the one `auth.user` root.
describe('Auth Module: the User state (#945)', () => {

  const IDENTITY = {
    uid: 'user-1',
    email: 'user@test.com',
    displayName: 'Test User',
    photoURL: 'https://example.com/me.png',
    emailVerified: true,
    providerData: [],
  };

  const PRO_DOC = { subscription: { product: { id: 'pro' }, status: 'active' } };

  it('should deliver a User built from the account document and the identity, as auth.user', async () => {
    const { auth, omega, states } = createHarness();

    auth._getAccountData = async () => PRO_DOC;
    auth.listen((state) => states.push(state));

    omega.firebaseAuth.currentUser = IDENTITY;
    auth._handleAuthStateChange(IDENTITY);
    await flush();

    assert.strictEqual(states.length, 1);
    const { user, denied } = states[0];
    assert(user instanceof User);
    assert.strictEqual(denied, false);
    assert.strictEqual(user.plan, 'pro');
    assert.strictEqual(user.active, true);
    assert.strictEqual(user.uid, 'user-1');
    assert.strictEqual(user.profile.displayName, 'Test User');
    assert.strictEqual(user.profile.emailVerified, true);
    assert.strictEqual(auth.user, user, 'auth.user is the very instance the callback received');
  });

  it('should hand the bindings the live User under auth.user, getters working', async () => {
    const { auth, omega, bindingsUpdates, storageWrites } = createHarness();

    auth._getAccountData = async () => PRO_DOC;
    auth.listen(() => {});

    omega.firebaseAuth.currentUser = IDENTITY;
    auth._handleAuthStateChange(IDENTITY);
    await flush();

    assert.strictEqual(bindingsUpdates.length, 1);
    assert.deepStrictEqual(Object.keys(bindingsUpdates[0].auth), ['user']);
    assert.strictEqual(bindingsUpdates[0].auth.user, auth.user);
    assert.strictEqual(bindingsUpdates[0].auth.user.plan, 'pro');
    assert.strictEqual(bindingsUpdates[0].auth.user.email, 'user@test.com');

    // Storage serializes the User to its stored document, so the persisted
    // identity sits under the document's `auth` branch (what sentry reads)
    const stored = JSON.parse(JSON.stringify(storageWrites[0][1]));
    assert.strictEqual(stored.user.auth.uid, 'user-1');
    assert.strictEqual(stored.user.auth.email, 'user@test.com');
    assert.strictEqual(stored.denied, false);
  });

  it('should enrich a missing displayName and photoURL from the provider entries', () => {
    const { auth } = createHarness();

    const identity = auth._identity({
      uid: 'user-1',
      email: 'user@test.com',
      displayName: null,
      photoURL: null,
      providerData: [{ displayName: 'Provider Name', photoURL: 'https://example.com/p.png' }],
    });

    assert.deepStrictEqual(identity, {
      uid: 'user-1',
      email: 'user@test.com',
      displayName: 'Provider Name',
      photoURL: 'https://example.com/p.png',
      emailVerified: false,
    });
    assert.strictEqual(auth._identity(null), null);
  });
});

// #196: a signed-in emission awaits the account fetch, a signed-out one fires
// instantly — so a slow fetch could deliver a STALE signed-in state after a
// newer signed-out one and make consumers redirect a signed-out page.
describe('Auth Module — auth state emission ordering (#196)', () => {

  const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };
  const PREMIUM_DOC = { subscription: { product: { id: 'premium' }, status: 'active' } };

  it('should drop a stale signed-in emission superseded by a signed-out one', async () => {
    const { auth, omega, states, bindingsUpdates, storageWrites } = createHarness();

    // Account fetch we control: the signed-in emission hangs on it
    let resolveAccountFetch;
    auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });

    auth.listen((state) => states.push(state));

    // Signed-in state change — starts the account fetch and blocks there
    omega.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();
    assert.strictEqual(states.length, 0);

    // Signed-out state change — no fetch, so it delivers immediately
    omega.firebaseAuth.currentUser = null;
    auth._handleAuthStateChange(null);
    await flush();
    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[0].user.authenticated, false);

    // The stale fetch finally resolves — its emission must be dropped
    resolveAccountFetch(PREMIUM_DOC);
    await flush();

    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[states.length - 1].user.authenticated, false);
    assert.strictEqual(auth.user.authenticated, false, 'the dropped emission never replaced auth.user');
    assert.strictEqual(bindingsUpdates.length, 1);
    assert.strictEqual(bindingsUpdates[0].auth.user.authenticated, false);
    assert.strictEqual(storageWrites.length, 1);
    assert.strictEqual(storageWrites[0][1].user.authenticated, false);
  });

  it('should still deliver a signed-in emission when no newer state supersedes it', async () => {
    const { auth, omega, states } = createHarness();

    let resolveAccountFetch;
    auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });

    auth.listen((state) => states.push(state));

    omega.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();
    assert.strictEqual(states.length, 0);

    resolveAccountFetch(PREMIUM_DOC);
    await flush();

    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[0].user.uid, 'user-1');
    assert.strictEqual(states[0].user.plan, 'premium');
  });

  it('should settle a once listener with the NEWEST state when its first build is superseded', async () => {
    const { auth, omega, states } = createHarness();

    let resolveAccountFetch;
    auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });

    // A once listener waiting on the first state, which blocks on the fetch
    auth.listen({ once: true }, (state) => states.push(state));

    omega.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();
    assert.strictEqual(states.length, 0);

    // A signed-out change supersedes the build: it is the first state to land,
    // so it settles the once listener (checkout boot and the extension auth
    // helpers await exactly this)
    omega.firebaseAuth.currentUser = null;
    auth._handleAuthStateChange(null);
    await flush();

    resolveAccountFetch(PREMIUM_DOC);
    await flush();

    assert.strictEqual(states.length, 1, 'the once listener must still fire, exactly once');
    assert.strictEqual(states[0].user.authenticated, false, 'and with the NEWEST state, not the stale one');
  });
});

// #945: ONE `User` per auth state change, built once before anything reads it,
// and every consumer (persistent listeners, once listeners, `auth.user`, the
// bindings) holds that same instance.
describe('Auth Module: one state build per change (#945)', () => {

  const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };
  const PRO_DOC = { subscription: { product: { id: 'pro' }, status: 'active' } };

  it('should fetch the account once and hand every listener the same User', async () => {
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

    assert.strictEqual(fetches, 1, 'one account fetch per auth state change, however many listen');
    assert.strictEqual(first.length, 1);
    assert.strictEqual(second.length, 1);
    assert.strictEqual(once.length, 1);
    assert.strictEqual(first[0].user.plan, 'pro');
    assert.strictEqual(second[0].user, first[0].user, 'both persistent listeners hold the same User');
    assert.strictEqual(once[0].user, first[0].user, 'the once listener holds it too');
    assert.strictEqual(auth.user, first[0].user, 'and it is auth.user');
    assert.strictEqual(bindingsUpdates.length, 1, 'the bindings update once');
    assert.strictEqual(bindingsUpdates[0].auth.user, auth.user);
    assert.strictEqual(storageWrites.length, 1, 'the storage writes once');
  });

  it('should catch a late persistent listener up with the landed state, once and asynchronously', async () => {
    const { auth, omega } = createHarness();

    let fetches = 0;
    auth._getAccountData = async () => { fetches++; return PRO_DOC; };

    omega.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();

    const late = [];
    auth.listen((state) => late.push(state));
    assert.strictEqual(late.length, 0, 'the catch-up never runs inside listen()');

    await flush();

    assert.strictEqual(late.length, 1, 'the late listener hears the landed state once');
    assert.strictEqual(late[0], auth.state);
    assert.strictEqual(late[0].user, auth.user);
    assert.strictEqual(fetches, 1, 'catching up builds nothing new');
  });

  it('should settle a once listener with the first landed state, and a later one with the newest', async () => {
    const { auth, omega } = createHarness();

    auth._getAccountData = async () => PRO_DOC;

    // Registered before anything landed: settles on the first state
    const early = [];
    auth.listen({ once: true }, (state) => early.push(state));

    omega.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();

    assert.strictEqual(early.length, 1);
    assert.strictEqual(early[0].user.uid, 'user-1');

    // A second state lands; a once listener registered after it gets that one
    omega.firebaseAuth.currentUser = null;
    auth._handleAuthStateChange(null);
    await flush();

    const later = [];
    auth.listen({ once: true }, (state) => later.push(state));
    await flush();

    assert.strictEqual(early.length, 1, 'the early once listener never fires again');
    assert.strictEqual(later.length, 1);
    assert.strictEqual(later[0], auth.state, 'the newest landed state');
    assert.strictEqual(later[0].user.authenticated, false);
  });
});

// #945: a page that wrote something the backend lands (a purchase, a cancel)
// re-reads the account through `omega.auth.reload()`: the same build as an auth
// state change, so the bindings, the storage and every listener move with it.
describe('Auth Module: reload() re-reads the account (#945)', () => {

  const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };
  const PRO_DOC = { subscription: { product: { id: 'pro' }, status: 'active' } };

  it('should rebuild auth.user from a fresh fetch and deliver it to every persistent listener', async () => {
    const { auth, omega, states, bindingsUpdates, storageWrites } = createHarness();

    auth._getAccountData = async () => ({});
    auth.listen((state) => states.push(state));

    omega.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();

    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[0].user.plan, 'basic');

    // The webhook landed the purchase
    auth._getAccountData = async () => PRO_DOC;
    const state = await auth.reload();

    assert.strictEqual(state.user.plan, 'pro');
    assert.strictEqual(state.denied, false);
    assert.strictEqual(state, auth.state, 'reload resolves with the landed state');
    assert.strictEqual(auth.user, state.user, 'auth.user is the rebuilt instance');
    assert.strictEqual(states.length, 2, 'every persistent listener hears the reload once more');
    assert.strictEqual(states[1], state);
    assert.strictEqual(bindingsUpdates.length, 2);
    assert.strictEqual(bindingsUpdates[1].auth.user, state.user, 'the bindings read the rebuilt User');
    assert.strictEqual(storageWrites.length, 2);
    assert.strictEqual(storageWrites[1][1], state, 'the storage holds the rebuilt state');
  });

  it('should land a signed-out User when no Firebase user is signed in', async () => {
    const { auth, states } = createHarness();

    let fetches = 0;
    auth._getAccountData = async () => { fetches++; return PRO_DOC; };
    auth.listen((state) => states.push(state));

    const state = await auth.reload();

    assert(state.user instanceof User);
    assert.strictEqual(state.user.authenticated, false);
    assert.strictEqual(auth.user, state.user);
    assert.strictEqual(fetches, 0, 'a signed-out reload fetches nothing');
    assert.strictEqual(states.length, 1);
  });

  it('should resolve with the newer landed state when a state change supersedes it mid-fetch', async () => {
    const { auth, omega, states } = createHarness();

    // Account fetch we control: the reload hangs on it
    let resolveAccountFetch;
    auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });
    auth.listen((state) => states.push(state));

    omega.firebaseAuth.currentUser = USER;
    const reloading = auth.reload();
    await flush();
    assert.strictEqual(states.length, 0);

    // A sign-out lands while the reload is still fetching
    omega.firebaseAuth.currentUser = null;
    auth._handleAuthStateChange(null);
    await flush();

    resolveAccountFetch(PRO_DOC);
    const state = await reloading;

    assert.strictEqual(state.user.authenticated, false, 'the reload resolves with the newer state');
    assert.strictEqual(state, auth.state);
    assert.strictEqual(states.length, 1, 'the stale reload is never delivered');
    assert.strictEqual(states[0], state);
    assert.strictEqual(auth.user.authenticated, false, 'and it never replaced auth.user');
  });

  it('should follow a superseding build that is itself still fetching', async () => {
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
    assert.strictEqual(fetches.length, 2);

    let settled = false;
    reloading.then(() => { settled = true; });

    fetches[0]({});
    await flush();
    assert.strictEqual(settled, false, 'the superseded reload waits for the newer build');

    fetches[1](PRO_DOC);
    const state = await reloading;

    assert.strictEqual(state.user.plan, 'pro', 'and resolves with what that build landed');
    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[0], state);
  });
});

// #700: a doc that is not written yet is the NORMAL state for the seconds after
// a signup, and a rules permission-denied on the account read is a real
// failure. Consumers branch on the SIGNAL (`state.denied`), never on the
// account being empty, since the web listener's deleted consent guard collapsed the
// two and signed fresh signups out.
describe('Auth Module — pending vs denied account reads (#700)', () => {

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
      firebaseFirestore: {},
      _resolveFirebaseConfig: () => ({ apiKey: 'test-api-key' }),
      bindings: { update: () => {} },
      storage: { set: () => {}, get: () => ({}) },
      sentry: { captureException: (error) => captured.push(error) },
    };

    return { auth: new Auth(omega), omega, captured };
  }

  const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

  before(() => {
    // Registered here, not at load: hooks route every later require through the
    // ESM loader, and the shared Omega import above pulls in CJS that will not
    // survive the trip.
    stubFirestoreModule();
  });

  it('should return an empty document when the doc is not written yet', async () => {
    const { auth } = createHarness();

    firestoreReturns(async () => ({ exists: () => false }));

    const document = await auth._getAccountData('user-1');

    assert.deepStrictEqual(document, {}, 'a missing doc is pending, not a failure: the User resolves it to the empty shape');
  });

  it('should return the raw stored document, leaving resolution to the User', async () => {
    const { auth } = createHarness();

    firestoreReturns(async () => ({ exists: () => true, data: () => PREMIUM_DOC }));

    assert.strictEqual(await auth._getAccountData('user-1'), PREMIUM_DOC);
  });

  it('should rethrow a permission-denied read so the caller can tell it from pending', async () => {
    const { auth, captured } = createHarness();

    firestoreReturns(async () => { throw denied(); });

    await assert.rejects(auth._getAccountData('user-1'), { code: 'permission-denied' });
    assert.strictEqual(captured.length, 1, 'and it still reaches monitoring');
  });

  it('should deliver denied on a permission-denied read, with a signed-in User still built', async () => {
    const { auth, omega } = createHarness();
    const states = [];

    firestoreReturns(async () => { throw denied(); });

    auth.listen((state) => states.push(state));

    omega.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();

    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[0].denied, true);
    assert(states[0].user instanceof User);
    assert.strictEqual(states[0].user.authenticated, true);
    assert.strictEqual(states[0].user.uid, 'user-1', 'the identity still lands, so nothing downstream null-checks');
    assert.strictEqual(states[0].user.plan, 'basic');
  });

  it('should degrade a non-permission failure to the empty account with denied false', async () => {
    const { auth, omega, captured } = createHarness();
    const states = [];

    firestoreReturns(async () => { throw new Error('network request failed'); });

    auth.listen((state) => states.push(state));

    omega.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();

    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[0].denied, false, 'a transient failure is not a denial');
    assert.strictEqual(states[0].user.uid, 'user-1');
    assert.strictEqual(captured.length, 1);
  });
});
