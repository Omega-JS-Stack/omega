const { describe, it, before } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

describe('Auth Module', () => {

  before(async () => {
    await getManager().initialize(TEST_CONFIG);
  });

  it('should expose expected methods', () => {
    const auth = getManager().auth();
    assert(typeof auth.listen === 'function');
    assert(typeof auth.signInWithEmailAndPassword === 'function');
    assert(typeof auth.signOut === 'function');
    assert(typeof auth.isAuthenticated === 'function');
    assert(typeof auth.getUser === 'function');
    assert(typeof auth.resolveSubscription === 'function');
  });

  it('should return unauthenticated when Firebase disabled', () => {
    assert.strictEqual(getManager().auth().isAuthenticated(), false);
    assert.strictEqual(getManager().auth().getUser(), null);
  });

  it('should call listener with null user when Firebase disabled', () => new Promise((resolve, reject) => {
    getManager().auth().listen((state) => {
      try {
        assert.strictEqual(state.user, null);
        assert(state.account);
        assert.strictEqual(state.account.subscription.product.id, 'basic');
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }));

  describe('resolveSubscription', () => {

    it('should return basic plan for no account', () => {
      const result = getManager().auth().resolveSubscription(null);
      assert.strictEqual(result.plan, 'basic');
      assert.strictEqual(result.active, false);
      assert.strictEqual(result.trialing, false);
      assert.strictEqual(result.cancelling, false);
      assert.strictEqual(result.everPaid, false);
    });

    it('should return basic for basic product', () => {
      const result = getManager().auth().resolveSubscription({
        subscription: { product: { id: 'basic' }, status: 'active' },
      });
      assert.strictEqual(result.plan, 'basic');
      assert.strictEqual(result.active, false);
    });

    it('should return active for paid plan with active status', () => {
      const result = getManager().auth().resolveSubscription({
        subscription: { product: { id: 'premium' }, status: 'active' },
      });
      assert.strictEqual(result.plan, 'premium');
      assert.strictEqual(result.active, true);
      assert.strictEqual(result.trialing, false);
      assert.strictEqual(result.cancelling, false);
    });

    it('should detect trialing state', () => {
      const futureUNIX = Math.floor(Date.now() / 1000) + 86400;
      const result = getManager().auth().resolveSubscription({
        subscription: {
          product: { id: 'premium' },
          status: 'active',
          trial: { claimed: true, expires: { timestampUNIX: futureUNIX } },
        },
      });
      assert.strictEqual(result.active, true);
      assert.strictEqual(result.trialing, true);
      assert.strictEqual(result.cancelling, false);
    });

    it('should detect cancelling state', () => {
      const result = getManager().auth().resolveSubscription({
        subscription: {
          product: { id: 'premium' },
          status: 'active',
          cancellation: { pending: true },
        },
      });
      assert.strictEqual(result.active, true);
      assert.strictEqual(result.cancelling, true);
      assert.strictEqual(result.trialing, false);
    });

    it('should return basic when status is not active', () => {
      const result = getManager().auth().resolveSubscription({
        subscription: { product: { id: 'premium' }, status: 'suspended' },
      });
      assert.strictEqual(result.plan, 'basic');
      assert.strictEqual(result.active, false);
    });

    it('should report everPaid when a payment startDate exists', () => {
      const result = getManager().auth().resolveSubscription({
        subscription: {
          product: { id: 'premium' },
          status: 'active',
          payment: { startDate: { timestampUNIX: 1735689600 } },
        },
      });
      assert.strictEqual(result.plan, 'premium');
      assert.strictEqual(result.active, true);
      assert.strictEqual(result.everPaid, true);
    });
  });
});

// #196: a signed-in emission awaits the account fetch, a signed-out one fires
// instantly — so a slow fetch could deliver a STALE signed-in state after a
// newer signed-out one and make consumers redirect a signed-out page.
describe('Auth Module — auth state emission ordering (#196)', () => {

  let Auth;

  const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };

  // Minimal Manager stand-in: enough of the surface run() touches, plus a
  // record of every bindings/storage write so a dropped emission is provable.
  function createHarness() {
    const bindingsUpdates = [];
    const storageWrites = [];
    const manager = {
      config: {},
      firebaseAuth: { currentUser: null },
      firebaseFirestore: {},
      _firebaseAuthInitialized: false,
      _authReady: Promise.resolve(),
      _resolveFirebaseConfig: () => ({ apiKey: 'test-api-key' }),
      bindings: () => ({ update: (payload) => bindingsUpdates.push(payload) }),
      storage: () => ({ set: (key, value) => storageWrites.push([key, value]), get: () => ({}) }),
    };

    const auth = new Auth(manager);
    const states = [];

    return { auth, manager, states, bindingsUpdates, storageWrites };
  }

  // Flush the microtask queue so every already-resolved await inside run() lands
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  before(async () => {
    Auth = (await import('../src/modules/auth.js')).default;
  });

  it('should drop a stale signed-in emission superseded by a signed-out one', async () => {
    const { auth, manager, states, bindingsUpdates, storageWrites } = createHarness();

    // Account fetch we control: the signed-in emission hangs on it
    let resolveAccountFetch;
    auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });

    auth.listen((state) => states.push(state));

    // Signed-in state change — starts the account fetch and blocks there
    manager.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();
    assert.strictEqual(states.length, 0);

    // Signed-out state change — no fetch, so it delivers immediately
    manager.firebaseAuth.currentUser = null;
    auth._handleAuthStateChange(null);
    await flush();
    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[0].user, null);

    // The stale fetch finally resolves — its emission must be dropped
    resolveAccountFetch({ id: 'stale-account' });
    await flush();

    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[states.length - 1].user, null);
    assert.strictEqual(bindingsUpdates.length, 1);
    assert.strictEqual(bindingsUpdates[0].auth.user, null);
    assert.strictEqual(storageWrites.length, 1);
    assert.strictEqual(storageWrites[0][1].user, null);
  });

  it('should still deliver a signed-in emission when no newer state supersedes it', async () => {
    const { auth, manager, states } = createHarness();

    let resolveAccountFetch;
    auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });

    auth.listen((state) => states.push(state));

    manager.firebaseAuth.currentUser = USER;
    auth._handleAuthStateChange(USER);
    await flush();
    assert.strictEqual(states.length, 0);

    resolveAccountFetch({ id: 'account-1' });
    await flush();

    assert.strictEqual(states.length, 1);
    assert.strictEqual(states[0].user.uid, 'user-1');
    assert.strictEqual(states[0].account.id, 'account-1');
  });

  it('should re-deliver a superseded ONCE emission instead of hanging its caller', async () => {
    const { auth, manager, states } = createHarness();

    let resolveAccountFetch;
    auth._getAccountData = () => new Promise((resolve) => { resolveAccountFetch = resolve; });

    // A once listener that settles signed in — it blocks on the account fetch
    manager.firebaseAuth.currentUser = USER;
    auth.listen({ once: true }, (state) => states.push(state));
    await flush();
    assert.strictEqual(states.length, 0);

    // A signed-out state change supersedes it. A once listener holds no
    // subscription, so nothing re-issues the emission for it — dropping it
    // would hang the awaiting caller (checkout boot, extension auth helpers).
    manager.firebaseAuth.currentUser = null;
    auth._handleAuthStateChange(null);
    await flush();

    resolveAccountFetch({ id: 'stale-account' });
    await flush();

    assert.strictEqual(states.length, 1, 'the once listener must still fire');
    assert.strictEqual(states[0].user, null, 'and with the NEWEST state, not the stale one');
  });
});
