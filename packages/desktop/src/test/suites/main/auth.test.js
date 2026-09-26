// Main-process tests for lib/auth.js (`omega.auth`): unit-level coverage that doesn't hit Firebase.
//
// Real Firebase integration tests live in auth.integration.test.js
// (gated on extended mode); the sign-in proof itself is #904's, through a
// persona the backend emulator seeds.

const { User } = require('@omega.js/account');
const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'auth (main, unit)',
  cleanup: async (ctx) => {
    await ctx.omega.auth._resetForTests();
  },
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.omega.auth._initialized).toBe(true);
      },
    },
    {
      name: 'IPC handlers are registered',
      run: (ctx) => {
        ctx.expect(ctx.omega.ipc.hasHandler('desktop:auth:sync-request')).toBe(true);
        ctx.expect(ctx.omega.ipc.hasHandler('desktop:auth:sign-out')).toBe(true);
        ctx.expect(ctx.omega.ipc.hasHandler('desktop:auth:get-user')).toBe(true);
      },
    },
    {
      // The public surface is exactly the account, its listener, and the three
      // session calls; the snapshot/plan/roles getters and onAuthChange retired
      // into `user` and `listen`.
      name: 'the public surface: user, listen, signOut, getIdToken, handleToken',
      run: (ctx) => {
        const auth = ctx.omega.auth;
        for (const name of ['listen', 'signOut', 'getIdToken', 'handleToken']) {
          ctx.expect(typeof auth[name]).toBe('function');
        }
        for (const name of ['getCurrentUser', 'getResolvedPlan', 'getResolvedRoles', 'onAuthChange', 'handleAuthToken']) {
          ctx.expect(auth[name]).toBeUndefined();
        }
      },
    },
    {
      name: 'user is a signed-out User when nothing is signed in',
      run: (ctx) => {
        // The harness boots without auth; either firebase isn't loaded (no cloud.config
        // in default config) or it is and there's no user. Either way, no renderer has
        // pushed an account, so `user` is the signed-out User.
        const user = ctx.omega.auth.user;
        ctx.expect(user).toBeInstanceOf(User);
        ctx.expect(user.authenticated).toBe(false);
        ctx.expect(user.uid).toBeNull();
        ctx.expect(user.plan).toBe('basic');
      },
    },
    {
      name: 'getIdToken returns null when nothing is signed in',
      run: async (ctx) => {
        // Same no-auth harness as the user case above: signed-in token
        // round-trips are the integration suite's domain.
        ctx.expect(await ctx.omega.auth.getIdToken()).toBeNull();
      },
    },
    {
      name: 'handleToken returns no-op result when firebase not loaded',
      run: async (ctx) => {
        // Default config has empty cloud.config → firebase fails to init → _firebaseAuth=null.
        if (ctx.omega.auth._firebaseAuth) {
          ctx.skip('firebase did load (cloud.config was set) — covered by integration tests');
        }
        const r = await ctx.omega.auth.handleToken('whatever');
        ctx.expect(r.success).toBe(false);
        ctx.expect(r.reason).toBe('firebase-not-loaded');
      },
    },
    {
      name: 'handleToken with empty token returns no-token failure',
      run: async (ctx) => {
        // Stub _firebaseAuth so we hit the "no token" branch instead of "firebase-not-loaded."
        const origAuth = ctx.omega.auth._firebaseAuth;
        ctx.omega.auth._firebaseAuth = { currentUser: null }; // truthy so we pass the firebase check
        try {
          const r = await ctx.omega.auth.handleToken('');
          ctx.expect(r.success).toBe(false);
          ctx.expect(r.reason).toBe('no-token');
        } finally {
          ctx.omega.auth._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sync-request: same UID → no sync needed',
      run: async (ctx) => {
        // Stub the auth so we control bgUid.
        const origAuth = ctx.omega.auth._firebaseAuth;
        ctx.omega.auth._firebaseAuth = { currentUser: { uid: 'abc' } };
        try {
          const result = await ctx.omega.ipc.invoke('desktop:auth:sync-request', { contextUid: 'abc' });
          ctx.expect(result.needsSync).toBe(false);
        } finally {
          ctx.omega.auth._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sync-request: main signed out, renderer signed in → tells renderer to sign out',
      run: async (ctx) => {
        const origAuth = ctx.omega.auth._firebaseAuth;
        ctx.omega.auth._firebaseAuth = { currentUser: null };
        try {
          const result = await ctx.omega.ipc.invoke('desktop:auth:sync-request', { contextUid: 'someone' });
          ctx.expect(result.needsSync).toBe(true);
          ctx.expect(result.signOut).toBe(true);
        } finally {
          ctx.omega.auth._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sync-request: firebase not loaded → no sync',
      run: async (ctx) => {
        const origAuth = ctx.omega.auth._firebaseAuth;
        ctx.omega.auth._firebaseAuth = null;
        try {
          const result = await ctx.omega.ipc.invoke('desktop:auth:sync-request', { contextUid: null });
          ctx.expect(result.needsSync).toBe(false);
          ctx.expect(result.reason).toBe('firebase-not-loaded');
        } finally {
          ctx.omega.auth._firebaseAuth = origAuth;
        }
      },
    },
    {
      name: 'sign-out IPC succeeds when nothing is signed in',
      run: async (ctx) => {
        const result = await ctx.omega.ipc.invoke('desktop:auth:sign-out');
        ctx.expect(result.success).toBe(true);
      },
    },
    {
      name: 'get-user IPC answers the signed-out account and no identity when no current user',
      run: async (ctx) => {
        const result = await ctx.omega.ipc.invoke('desktop:auth:get-user');
        ctx.expect(result.uid).toBeNull();
        ctx.expect(result.identity).toBeNull();
        ctx.expect(result.document).toEqual(ctx.omega.auth.user.toJSON());
        ctx.expect(new User(result.document).authenticated).toBe(false);
      },
    },
    {
      // A renderer's `omega-signin` trigger lands here: main's own sign-in flow.
      // openAuthFlow is stubbed because the real one opens the user's browser.
      name: 'open-flow IPC runs omega.openAuthFlow()',
      run: async (ctx) => {
        let flows = 0;
        ctx.omega.openAuthFlow = async () => { flows++; return { url: 'https://localhost:4000/signin' }; };
        try {
          const result = await ctx.omega.ipc.invoke('desktop:auth:open-flow');
          ctx.expect(flows).toBe(1);
          ctx.expect(result).toEqual({ url: 'https://localhost:4000/signin' });
        } finally {
          delete ctx.omega.openAuthFlow;
        }
      },
    },
    {
      // A renderer's `omega-account` trigger: the website's /account page, on the
      // host getWebsiteUrl() answers (the staged dev origin in this testing run)
      name: 'open-account IPC opens <website>/account in the user\'s browser',
      run: async (ctx) => {
        const electron = require('electron');
        const opened = [];
        const origOpen = electron.shell.openExternal;
        const origDev = ctx.omega.config.dev;
        electron.shell.openExternal = async (url) => { opened.push(url); };
        ctx.omega.config.dev = { origin: 'https://localhost:4000' };
        try {
          await ctx.omega.ipc.invoke('desktop:auth:open-account');
          ctx.expect(opened).toEqual(['https://localhost:4000/account']);
        } finally {
          electron.shell.openExternal = origOpen;
          if (origDev !== undefined) ctx.omega.config.dev = origDev; else delete ctx.omega.config.dev;
        }
      },
    },
    {
      name: 'listen: a catch-up with the current state after it returns, then every landing, until unsubscribed',
      run: async (ctx) => {
        const auth = ctx.omega.auth;
        const heard = [];
        const off = auth.listen((state) => heard.push(state.user));

        // The catch-up is async: nothing is heard before listen() returns
        ctx.expect(heard.length).toBe(0);
        await Promise.resolve();
        ctx.expect(heard.length).toBe(1);
        ctx.expect(heard[0]).toBe(auth.user);

        const landed = new User({}, { uid: 'u-listen', email: 'l@x.y' });
        auth._land(landed);
        ctx.expect(heard.length).toBe(2);
        ctx.expect(heard[1]).toBe(landed);

        off();
        auth._land(new User());
        ctx.expect(heard.length).toBe(2);
        ctx.expect(auth.user.authenticated).toBe(false);
      },
    },
    {
      name: '_identity returns the sign-in identity shape (no token)',
      run: (ctx) => {
        const snap = ctx.omega.auth._identity({
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
      // auth's OWN seams (_firebase / _firebaseModule, filled by
      // _tryLoadFirebase) — swapping those recording namespaces in drives the real
      // method, no stubbing of the module under test. The omega instance is an input too:
      // isTesting() is the whole gate.
      name: 'auth emulator: a testing run connects, dev/production never do',
      run: (ctx) => {
        const auth = ctx.omega.auth;
        const saved = {
          firebase:  auth._firebase,
          module:    auth._firebaseModule,
          auth:      auth._firebaseAuth,
          omega:     auth._omega,
          port:      process.env.OMEGA_AUTH_PORT,
        };

        // One recording firebase namespace pair, reused per run
        const connects = [];
        const authInstance = { __auth: true };
        auth._firebase = {
          getApp:        () => { throw new Error('no app'); },
          initializeApp: () => ({ __app: true }),
        };
        auth._firebaseModule = {
          getAuth: () => authInstance,
          connectAuthEmulator: (auth, url, opts) => connects.push({ auth, url, opts }),
        };

        const run = (isTesting, dev) => {
          auth._firebaseAuth = null;
          auth._omega = {
            config: { cloud: { config: { apiKey: 'AIza-test', projectId: 'demo-desktop' } }, ...(dev ? { dev } : {}) },
            isTesting: () => isTesting,
          };
          return auth._getFirebaseAuth(null);
        };

        try {
          delete process.env.OMEGA_AUTH_PORT;

          // production / dev shape — no emulator, ever
          ctx.expect(run(false)).toBe(authInstance);
          ctx.expect(connects.length).toBe(0);

          // testing shape: the port comes from the map the bundle baked, which
          // carries @omega.js/config's classic 9099 as its floor
          // ([#834](https://github.com/Omega-JS-Stack/omega/issues/834)).
          ctx.expect(run(true, { ports: { auth: 9099 } })).toBe(authInstance);
          ctx.expect(connects.length).toBe(1);
          ctx.expect(connects[0].auth).toBe(authInstance);
          ctx.expect(connects[0].url).toBe('http://localhost:9099');

          // a bumped port arrives on OMEGA_AUTH_PORT (N7)
          process.env.OMEGA_AUTH_PORT = '9199';
          run(true, { ports: { auth: 9099 } });
          ctx.expect(connects.length).toBe(2);
          ctx.expect(connects[1].url).toBe('http://localhost:9199');

          // Neither channel is a broken artifact, and it says so by name
          // rather than dialling a port nothing identity-checks (#834).
          delete process.env.OMEGA_AUTH_PORT;
          let threw;
          try { run(true); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/dev port for `auth`/);
          ctx.expect(threw.message).toMatch(/bundle task/);
          ctx.expect(connects.length).toBe(2);
        } finally {
          auth._firebase       = saved.firebase;
          auth._firebaseModule = saved.module;
          auth._firebaseAuth   = saved.auth;
          auth._omega          = saved.omega;
          if (saved.port === undefined) delete process.env.OMEGA_AUTH_PORT;
          else                          process.env.OMEGA_AUTH_PORT = saved.port;
        }
      },
    },
    {
      name: 'deep-link auth/token route is wired to handleToken',
      run: async (ctx) => {
        // We've already tested the deep-link side in deep-link.test.js. Here we verify
        // the integration is actually live: dispatching the route triggers our spy.
        let received = null;
        const orig = ctx.omega.auth.handleToken;
        ctx.omega.auth.handleToken = async (token) => {
          received = token;
          return { success: true };
        };
        try {
          ctx.omega.deepLink.dispatch('myapp://auth/token?authToken=BRIDGE-TEST-TOKEN');
          // Built-in handler is sync up to the await — give it a tick.
          await new Promise((r) => setImmediate(r));
          ctx.expect(received).toBe('BRIDGE-TEST-TOKEN');
        } finally {
          ctx.omega.auth.handleToken = orig;
        }
      },
    },
  ],
});
