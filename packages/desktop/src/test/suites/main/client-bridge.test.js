// Main-process tests for lib/client-bridge.js — unit-level coverage that doesn't hit Firebase.
//
// Real Firebase integration tests live in client-bridge.integration.test.js
// (gated on OMEGA_TEST_FIREBASE_ADMIN_KEY presence).

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'client-bridge (main, unit)',
  cleanup: async (ctx) => {
    await ctx.manager.omega._resetForTests();
  },
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.omega._initialized).toBe(true);
      },
    },
    {
      name: 'IPC handlers are registered',
      run: (ctx) => {
        ctx.expect(ctx.manager.ipc.hasHandler('desktop:auth:sync-request')).toBe(true);
        ctx.expect(ctx.manager.ipc.hasHandler('desktop:auth:sign-out')).toBe(true);
        ctx.expect(ctx.manager.ipc.hasHandler('desktop:auth:get-user')).toBe(true);
      },
    },
    {
      name: 'getCurrentUser returns null when nothing is signed in',
      run: (ctx) => {
        // The harness boots without auth; either firebase isn't loaded (no cloud.config
        // in default config) or it is and there's no user. Either way, currentUser is null.
        ctx.expect(ctx.manager.omega.getCurrentUser()).toBeNull();
      },
    },
    {
      name: 'getIdToken returns null when nothing is signed in',
      run: async (ctx) => {
        // Same no-auth harness as getCurrentUser above — signed-in token
        // round-trips are the integration suite's domain.
        ctx.expect(await ctx.manager.omega.getIdToken()).toBeNull();
      },
    },
    {
      name: 'handleAuthToken returns no-op result when firebase not loaded',
      run: async (ctx) => {
        // Default config has empty cloud.config → firebase fails to init → _firebaseAuth=null.
        if (ctx.manager.omega._firebaseAuth) {
          ctx.skip('firebase did load (cloud.config was set) — covered by integration tests');
        }
        const r = await ctx.manager.omega.handleAuthToken('whatever');
        ctx.expect(r.success).toBe(false);
        ctx.expect(r.reason).toBe('firebase-not-loaded');
      },
    },
    {
      name: 'handleAuthToken with empty token returns no-token failure',
      run: async (ctx) => {
        // Stub _firebaseAuth so we hit the "no token" branch instead of "firebase-not-loaded."
        const origAuth = ctx.manager.omega._firebaseAuth;
        ctx.manager.omega._firebaseAuth = { currentUser: null }; // truthy so we pass the firebase check
        try {
          const r = await ctx.manager.omega.handleAuthToken('');
          ctx.expect(r.success).toBe(false);
          ctx.expect(r.reason).toBe('no-token');
        } finally {
          ctx.manager.omega._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sync-request: same UID → no sync needed',
      run: async (ctx) => {
        // Stub the auth so we control bgUid.
        const origAuth = ctx.manager.omega._firebaseAuth;
        ctx.manager.omega._firebaseAuth = { currentUser: { uid: 'abc' } };
        try {
          const result = await ctx.manager.ipc.invoke('desktop:auth:sync-request', { contextUid: 'abc' });
          ctx.expect(result.needsSync).toBe(false);
        } finally {
          ctx.manager.omega._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sync-request: main signed out, renderer signed in → tells renderer to sign out',
      run: async (ctx) => {
        const origAuth = ctx.manager.omega._firebaseAuth;
        ctx.manager.omega._firebaseAuth = { currentUser: null };
        try {
          const result = await ctx.manager.ipc.invoke('desktop:auth:sync-request', { contextUid: 'someone' });
          ctx.expect(result.needsSync).toBe(true);
          ctx.expect(result.signOut).toBe(true);
        } finally {
          ctx.manager.omega._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sync-request: firebase not loaded → no sync',
      run: async (ctx) => {
        const origAuth = ctx.manager.omega._firebaseAuth;
        ctx.manager.omega._firebaseAuth = null;
        try {
          const result = await ctx.manager.ipc.invoke('desktop:auth:sync-request', { contextUid: null });
          ctx.expect(result.needsSync).toBe(false);
          ctx.expect(result.reason).toBe('firebase-not-loaded');
        } finally {
          ctx.manager.omega._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sign-out IPC succeeds when nothing is signed in',
      run: async (ctx) => {
        const result = await ctx.manager.ipc.invoke('desktop:auth:sign-out');
        ctx.expect(result.success).toBe(true);
      },
    },
    {
      name: 'get-user IPC returns null when no current user',
      run: async (ctx) => {
        const result = await ctx.manager.ipc.invoke('desktop:auth:get-user');
        ctx.expect(result).toBeNull();
      },
    },
    {
      name: 'onAuthChange returns an unsubscribe fn',
      run: (ctx) => {
        const fn = () => {};
        const off = ctx.manager.omega.onAuthChange(fn);
        ctx.expect(ctx.manager.omega._stateSubs.has(fn)).toBe(true);
        off();
        ctx.expect(ctx.manager.omega._stateSubs.has(fn)).toBe(false);
      },
    },
    {
      name: '_snapshotUser returns the public user shape (no token)',
      run: (ctx) => {
        const snap = ctx.manager.omega._snapshotUser({
          uid: 'u1',
          email: 'a@b.com',
          displayName: 'Bob',
          photoURL: 'http://x/p.png',
          emailVerified: true,
          // sensitive stuff that should NOT be exposed
          stsTokenManager: { accessToken: 'SECRET' },
          providerData: ['xxx'],
        });
        ctx.expect(snap).toEqual({
          uid: 'u1',
          email: 'a@b.com',
          displayName: 'Bob',
          photoURL: 'http://x/p.png',
          emailVerified: true,
        });
      },
    },
    {
      // The emulator gate (#46). _getFirebaseAuth resolves firebase through the
      // bridge's OWN seams (_firebase / _firebaseModule, filled by
      // _tryLoadFirebase) — swapping those recording namespaces in drives the real
      // method, no stubbing of the module under test. The manager is an input too:
      // isTesting() is the whole gate.
      name: 'auth emulator: a testing run connects, dev/production never do',
      run: (ctx) => {
        const bridge = ctx.manager.omega;
        const saved = {
          firebase:  bridge._firebase,
          module:    bridge._firebaseModule,
          auth:      bridge._firebaseAuth,
          manager:   bridge._manager,
          port:      process.env.OMEGA_AUTH_PORT,
        };

        // One recording firebase namespace pair, reused per run
        const connects = [];
        const authInstance = { __auth: true };
        bridge._firebase = {
          getApp:        () => { throw new Error('no app'); },
          initializeApp: () => ({ __app: true }),
        };
        bridge._firebaseModule = {
          getAuth: () => authInstance,
          connectAuthEmulator: (auth, url, opts) => connects.push({ auth, url, opts }),
        };

        const run = (isTesting) => {
          bridge._firebaseAuth = null;
          bridge._manager = {
            config: { cloud: { config: { apiKey: 'AIza-test', projectId: 'demo-desktop' } } },
            isTesting: () => isTesting,
          };
          return bridge._getFirebaseAuth(null);
        };

        try {
          delete process.env.OMEGA_AUTH_PORT;

          // production / dev shape — no emulator, ever
          ctx.expect(run(false)).toBe(authInstance);
          ctx.expect(connects.length).toBe(0);

          // testing shape — classic 9099 when no resolved port is on the env channel
          ctx.expect(run(true)).toBe(authInstance);
          ctx.expect(connects.length).toBe(1);
          ctx.expect(connects[0].auth).toBe(authInstance);
          ctx.expect(connects[0].url).toBe('http://localhost:9099');

          // a bumped port arrives on OMEGA_AUTH_PORT (N7)
          process.env.OMEGA_AUTH_PORT = '9199';
          run(true);
          ctx.expect(connects.length).toBe(2);
          ctx.expect(connects[1].url).toBe('http://localhost:9199');
        } finally {
          bridge._firebase       = saved.firebase;
          bridge._firebaseModule = saved.module;
          bridge._firebaseAuth   = saved.auth;
          bridge._manager        = saved.manager;
          if (saved.port === undefined) delete process.env.OMEGA_AUTH_PORT;
          else                          process.env.OMEGA_AUTH_PORT = saved.port;
        }
      },
    },
    {
      name: 'deep-link auth/token route is wired to handleAuthToken',
      run: async (ctx) => {
        // We've already tested the deep-link side in deep-link.test.js. Here we verify
        // the integration is actually live: dispatching the route triggers our spy.
        let received = null;
        const orig = ctx.manager.omega.handleAuthToken;
        ctx.manager.omega.handleAuthToken = async (token) => {
          received = token;
          return { success: true };
        };
        try {
          ctx.manager.deepLink.dispatch('myapp://auth/token?authToken=BRIDGE-TEST-TOKEN');
          // Built-in handler is sync up to the await — give it a tick.
          await new Promise((r) => setImmediate(r));
          ctx.expect(received).toBe('BRIDGE-TEST-TOKEN');
        } finally {
          ctx.manager.omega.handleAuthToken = orig;
        }
      },
    },
  ],
});
