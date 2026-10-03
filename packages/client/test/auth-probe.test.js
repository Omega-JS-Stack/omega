const defineCases = require('@omega.js/devkit/test/define-cases');
const { registerHooks } = require('node:module');
const { createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'auth-probe',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    // #798: Firebase learns a session died at page load and at the hourly refresh
    // and at no other moment, so a revoked, disabled or deleted account keeps an
    // open tab signed in. The probe is the forced token refresh at a moment of
    // doubt: an auth error means the session is gone (sign out, and the policy
    // listener redirects off the onAuthStateChanged emission), a network error
    // keeps the user, because a bad connection never signs anyone out.
    ...(() => {
      const cases = [];
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

      // Minimal Omega stand-in (the #196 harness's shape), plus the record of
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
            omega.firebaseAuth.currentUser = null;
            return true;
          },
        };

        const omega = {
          config: {},
          firebaseAuth: { currentUser: user },
          // Firebase is configured (the app exists), and Firestore loads through the loader
          firebaseApp: {},
          loadFirebaseFirestore: async () => ({}),
          _resolveFirebaseConfig: () => ({ apiKey: 'test-api-key' }),
          bindings: { update: () => {} },
          storage: { set: () => {}, get: () => ({}) },
        };

        return { auth: new Auth(omega), omega, calls };
      }

      const authError = (code) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

      // Flush the microtask queue so the lazy `import('firebase/auth')` inside
      // getIdToken has landed and the stub has really been called
      const flush = () => new Promise((resolve) => setImmediate(resolve));

      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        Auth = (await import('../src/modules/auth.js')).default;
        // Registered here, not at load: hooks route every later require through the
        // ESM loader, and the shared helpers' Omega import pulls in CJS that will
        // not survive the trip.
        stubAuthModule();
      })()));

      const beforeEachHook2 = () => {
        delete globalThis.__omegaAuth;
      };

      cases.push({
        name: 'Auth Module: the session probe (#798) > should sign out and report the session gone on an expired token',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          const { auth, calls } = createHarness({ refresh: () => { throw authError('auth/user-token-expired'); } });

          ctx.expect(await auth.probeSession()).toBe('gone');
          ctx.expect(calls.signOut, 'the onAuthStateChanged emission is what drives the policy listener').toBe(1);
          ctx.expect(calls.getIdToken[0].force, 'the probe is a FORCED refresh, since a cached token proves nothing').toBe(true);
        },
      });

      cases.push({
        name: 'Auth Module: the session probe (#798) > should sign out on every other non-network auth error',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          for (const code of ['auth/user-disabled', 'auth/invalid-refresh-token']) {
            const { auth, calls } = createHarness({ refresh: () => { throw authError(code); } });

            ctx.expect(await auth.probeSession(), code).toBe('gone');
            ctx.expect(calls.signOut, code).toBe(1);
          }
        },
      });

      cases.push({
        name: 'Auth Module: the session probe (#798) > should KEEP the user on a network failure, because a bad connection is not a dead session',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          const { auth, calls, omega } = createHarness({ refresh: () => { throw authError('auth/network-request-failed'); } });

          ctx.expect(await auth.probeSession()).toBe('unknown');
          ctx.expect(calls.signOut).toBe(0);
          ctx.expect(omega.firebaseAuth.currentUser, 'the user survives the "Backend starting" window').toBe(USER);
        },
      });

      cases.push({
        name: 'Auth Module: the session probe (#798) > should KEEP the user on auth/too-many-requests, a throttle and not a verdict on the session',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          const { auth, calls, omega } = createHarness({ refresh: () => { throw authError('auth/too-many-requests'); } });

          ctx.expect(await auth.probeSession()).toBe('unknown');
          ctx.expect(calls.signOut).toBe(0);
          ctx.expect(omega.firebaseAuth.currentUser, 'a rate limit clears on its own; the session did not die').toBe(USER);
        },
      });

      cases.push({
        name: 'Auth Module: the session probe (#798) > should KEEP the user on auth/internal-error, which is the Auth server failing and not answering',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          const { auth, calls, omega } = createHarness({ refresh: () => { throw authError('auth/internal-error'); } });

          ctx.expect(await auth.probeSession()).toBe('unknown');
          ctx.expect(calls.signOut).toBe(0);
          ctx.expect(omega.firebaseAuth.currentUser, 'a server-side failure is no verdict on this session').toBe(USER);
        },
      });

      cases.push({
        name: 'Auth Module: the session probe (#798) > should keep the user on an error carrying no auth code',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          const { auth, calls } = createHarness({ refresh: () => { throw new Error('something else broke'); } });

          ctx.expect(await auth.probeSession()).toBe('unknown');
          ctx.expect(calls.signOut).toBe(0);
        },
      });

      cases.push({
        name: 'Auth Module: the session probe (#798) > should report the session alive when the refresh succeeds',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          const { auth, calls } = createHarness({ refresh: () => 'fresh-id-token' });

          ctx.expect(await auth.probeSession()).toBe('alive');
          ctx.expect(calls.signOut).toBe(0);
          ctx.expect(calls.getIdToken.length).toBe(1);
        },
      });

      cases.push({
        name: 'Auth Module: the session probe (#798) > should coalesce concurrent probes into ONE refresh',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          let settleRefresh;
          const { auth, calls } = createHarness({ refresh: () => new Promise((resolve) => { settleRefresh = resolve; }) });

          const first = auth.probeSession();
          const second = auth.probeSession();

          await flush();
          settleRefresh('fresh-id-token');
          const results = await Promise.all([first, second]);

          ctx.expect(calls.getIdToken.length, 'one probe in flight per Auth instance').toBe(1);
          ctx.expect(results, 'every caller during it gets the same answer').toEqual(['alive', 'alive']);

          // And the slot is cleared, so the NEXT moment of doubt probes again
          const third = auth.probeSession();
          await flush();
          settleRefresh('fresh-id-token');

          ctx.expect(await third).toBe('alive');
          ctx.expect(calls.getIdToken.length).toBe(2);
        },
      });

      cases.push({
        name: 'Auth Module: the session probe (#798) > should no-op on a signed-out client',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          beforeEachHook2();
          const { auth, calls } = createHarness({ user: null, refresh: () => { throw new Error('must not be called'); } });

          ctx.expect(await auth.probeSession()).toBe('signed-out');
          ctx.expect(calls.getIdToken.length).toBe(0);
          ctx.expect(calls.signOut).toBe(0);
        },
      });
      return cases;
    })(),
  ],
});
