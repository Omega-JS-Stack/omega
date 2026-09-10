const { describe, it, before, beforeEach } = require('node:test');
const { registerHooks } = require('node:module');
const { assert } = require('./helpers.js');

// #798: Firebase learns a session died at page load and at the hourly refresh
// and at no other moment, so a revoked, disabled or deleted account keeps an
// open tab signed in. The probe is the forced token refresh at a moment of
// doubt: an auth error means the session is gone (sign out, and the policy
// listener redirects off the onAuthStateChanged emission), a network error
// keeps the user, because a bad connection never signs anyone out.
describe('Auth Module: the session probe (#798)', () => {

  let Auth;

  const USER = { uid: 'user-1', email: 'user@test.com', emailVerified: true, metadata: {}, providerData: [] };

  // `getIdToken` and `signOut` both import firebase/auth lazily, so the seam is
  // the module resolution itself (the #700 firestore stub's pattern): a
  // synchronous hook swaps that ONE specifier for a stub reading
  // `globalThis.__omegaAuth`. Scoped to this file, since node's runner gives each
  // test file its own process.
  const AUTH_STUB_URL = 'omega-test-stub:firebase-auth';

  const stubAuthModule = () => registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'firebase/auth') {
        return { url: AUTH_STUB_URL, shortCircuit: true };
      }

      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === AUTH_STUB_URL) {
        return {
          format: 'module',
          shortCircuit: true,
          source: `export const getIdToken = (...args) => globalThis.__omegaAuth.getIdToken(...args);
                   export const signOut = (...args) => globalThis.__omegaAuth.signOut(...args);`,
        };
      }

      return nextLoad(url, context);
    },
  });

  // Minimal Manager stand-in (the #196 harness's shape), plus the record of
  // every stubbed firebase/auth call the probe makes.
  function createHarness({ user = USER, refresh } = {}) {
    const calls = { getIdToken: [], signOut: 0 };

    globalThis.__omegaAuth = {
      getIdToken: async (target, force) => {
        calls.getIdToken.push({ uid: target.uid, force });
        return refresh();
      },
      signOut: async () => {
        calls.signOut++;
        manager.firebaseAuth.currentUser = null;
        return true;
      },
    };

    const manager = {
      config: {},
      firebaseAuth: { currentUser: user },
      firebaseFirestore: {},
      _firebaseAuthInitialized: true,
      _authReady: Promise.resolve(),
      _resolveFirebaseConfig: () => ({ apiKey: 'test-api-key' }),
      bindings: () => ({ update: () => {} }),
      storage: () => ({ set: () => {}, get: () => ({}) }),
    };

    return { auth: new Auth(manager), manager, calls };
  }

  const authError = (code) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

  // Flush the microtask queue so the lazy `import('firebase/auth')` inside
  // getIdToken has landed and the stub has really been called
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  before(async () => {
    Auth = (await import('../src/modules/auth.js')).default;
    // Registered here, not at load: hooks route every later require through the
    // ESM loader, and the shared helpers' Manager import pulls in CJS that will
    // not survive the trip.
    stubAuthModule();
  });

  beforeEach(() => {
    delete globalThis.__omegaAuth;
  });

  it('should sign out and report the session gone on an expired token', async () => {
    const { auth, calls } = createHarness({ refresh: () => { throw authError('auth/user-token-expired'); } });

    assert.strictEqual(await auth.probeSession(), 'gone');
    assert.strictEqual(calls.signOut, 1, 'the onAuthStateChanged emission is what drives the policy listener');
    assert.strictEqual(calls.getIdToken[0].force, true, 'the probe is a FORCED refresh, since a cached token proves nothing');
  });

  it('should sign out on every other non-network auth error', async () => {
    for (const code of ['auth/user-disabled', 'auth/invalid-refresh-token']) {
      const { auth, calls } = createHarness({ refresh: () => { throw authError(code); } });

      assert.strictEqual(await auth.probeSession(), 'gone', code);
      assert.strictEqual(calls.signOut, 1, code);
    }
  });

  it('should KEEP the user on a network failure, because a bad connection is not a dead session', async () => {
    const { auth, calls, manager } = createHarness({ refresh: () => { throw authError('auth/network-request-failed'); } });

    assert.strictEqual(await auth.probeSession(), 'unknown');
    assert.strictEqual(calls.signOut, 0);
    assert.strictEqual(manager.firebaseAuth.currentUser, USER, 'the user survives the "Backend starting" window');
  });

  it('should KEEP the user on auth/too-many-requests, a throttle and not a verdict on the session', async () => {
    const { auth, calls, manager } = createHarness({ refresh: () => { throw authError('auth/too-many-requests'); } });

    assert.strictEqual(await auth.probeSession(), 'unknown');
    assert.strictEqual(calls.signOut, 0);
    assert.strictEqual(manager.firebaseAuth.currentUser, USER, 'a rate limit clears on its own; the session did not die');
  });

  it('should KEEP the user on auth/internal-error, which is the Auth server failing and not answering', async () => {
    const { auth, calls, manager } = createHarness({ refresh: () => { throw authError('auth/internal-error'); } });

    assert.strictEqual(await auth.probeSession(), 'unknown');
    assert.strictEqual(calls.signOut, 0);
    assert.strictEqual(manager.firebaseAuth.currentUser, USER, 'a server-side failure is no verdict on this session');
  });

  it('should keep the user on an error carrying no auth code', async () => {
    const { auth, calls } = createHarness({ refresh: () => { throw new Error('something else broke'); } });

    assert.strictEqual(await auth.probeSession(), 'unknown');
    assert.strictEqual(calls.signOut, 0);
  });

  it('should report the session alive when the refresh succeeds', async () => {
    const { auth, calls } = createHarness({ refresh: () => 'fresh-id-token' });

    assert.strictEqual(await auth.probeSession(), 'alive');
    assert.strictEqual(calls.signOut, 0);
    assert.strictEqual(calls.getIdToken.length, 1);
  });

  it('should coalesce concurrent probes into ONE refresh', async () => {
    let settleRefresh;
    const { auth, calls } = createHarness({ refresh: () => new Promise((resolve) => { settleRefresh = resolve; }) });

    const first = auth.probeSession();
    const second = auth.probeSession();

    await flush();
    settleRefresh('fresh-id-token');
    const results = await Promise.all([first, second]);

    assert.strictEqual(calls.getIdToken.length, 1, 'one probe in flight per Auth instance');
    assert.deepStrictEqual(results, ['alive', 'alive'], 'every caller during it gets the same answer');

    // And the slot is cleared, so the NEXT moment of doubt probes again
    const third = auth.probeSession();
    await flush();
    settleRefresh('fresh-id-token');

    assert.strictEqual(await third, 'alive');
    assert.strictEqual(calls.getIdToken.length, 2);
  });

  it('should no-op on a signed-out client', async () => {
    const { auth, calls } = createHarness({ user: null, refresh: () => { throw new Error('must not be called'); } });

    assert.strictEqual(await auth.probeSession(), 'signed-out');
    assert.strictEqual(calls.getIdToken.length, 0);
    assert.strictEqual(calls.signOut, 0);
  });
});
