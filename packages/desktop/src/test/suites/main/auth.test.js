// Main-process tests for lib/auth.js (`omega.auth`): unit-level coverage that doesn't hit Firebase.
//
// Real Firebase integration tests live in auth.integration.test.js
// (gated on extended mode); the sign-in proof itself is #904's, through a
// persona the backend emulator seeds.

const { User } = require('@omega.js/account');
const defineCases = require('@omega.js/devkit/test/define-cases');

// The identity tag LoggerLite puts first on every console line the auth logger writes
const AUTH_TAG = '[@omega.js/desktop:auth]';

// The two cloud configs that carry no apiKey: an empty object, and the
// default config's all-empty-strings shape
const NO_API_KEY_CONFIGS = [
  {},
  {
    apiKey:            '',
    authDomain:        '',
    databaseURL:       '',
    projectId:         '',
    storageBucket:     '',
    messagingSenderId: '',
    appId:             '',
    measurementId:     '',
  },
];

// Re-run auth.initialize on the real omega with `cloudConfig` as cloud.config,
// from a fresh state (uninitialized, Firebase unloaded), then put every field back.
// Answers the warn- and error-level lines the auth logger wrote during initialize,
// what it left in `_firebase` and `_firebaseAuth`, and handleToken('x') in that state.
async function initializeWithCloudConfig(ctx, cloudConfig) {
  const auth = ctx.omega.auth;
  const cloud = ctx.omega.config.cloud;
  const saved = {
    config:       cloud.config,
    initialized:  auth._initialized,
    firebase:     auth._firebase,
    firebaseAuth: auth._firebaseAuth,
    module:       auth._firebaseModule,
  };
  const realWarn = console.warn;
  const realError = console.error;
  const lines = [];
  const capture = (level) => (...args) => {
    if (args[0] === AUTH_TAG) lines.push(`${level}: ${args.slice(1).join(' ')}`);
  };

  auth._initialized = false;
  auth._firebase = null;
  auth._firebaseAuth = null;
  auth._firebaseModule = null;
  cloud.config = cloudConfig;
  console.warn = capture('warn');
  console.error = capture('error');
  try {
    await auth.initialize(ctx.omega);
    console.warn = realWarn;
    console.error = realError;
    return {
      lines,
      firebase:     auth._firebase,
      firebaseAuth: auth._firebaseAuth,
      token:        await auth.handleToken('x'),
    };
  } finally {
    console.warn = realWarn;
    console.error = realError;
    cloud.config = saved.config;
    auth._initialized = saved.initialized;
    auth._firebase = saved.firebase;
    auth._firebaseAuth = saved.firebaseAuth;
    auth._firebaseModule = saved.module;
  }
}

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
      name: 'initialize with no cloud apiKey writes no warn or error line',
      run: async (ctx) => {
        for (const cloudConfig of NO_API_KEY_CONFIGS) {
          const { lines } = await initializeWithCloudConfig(ctx, cloudConfig);
          ctx.expect(lines, `cloud.config ${JSON.stringify(cloudConfig)}`).toEqual([]);
        }
      },
    },
    {
      name: 'initialize with no cloud apiKey never loads Firebase',
      run: async (ctx) => {
        for (const cloudConfig of NO_API_KEY_CONFIGS) {
          const label = `cloud.config ${JSON.stringify(cloudConfig)}`;
          const { firebase, firebaseAuth, token } = await initializeWithCloudConfig(ctx, cloudConfig);
          ctx.expect(firebase == null, `${label}: _firebase`).toBe(true);
          ctx.expect(firebaseAuth, `${label}: _firebaseAuth`).toBeNull();
          ctx.expect(token, label).toEqual({ success: false, reason: 'firebase-not-loaded' });
        }
      },
    },
    {
      // The harness booted on the default config, which has no apiKey, so these
      // are the handlers the no-apiKey branch of initialize registered
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
        // The default config has no apiKey, so the harness boot skipped Firebase: _firebaseAuth=null.
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
      // A signed-in session whose Firebase signOut fails: the failure reaches the
      // renderer's invoke, and no window is told to sign itself out.
      name: 'sign-out IPC rejects with the Firebase error when signOut throws',
      run: async (ctx) => {
        const auth = ctx.omega.auth;
        const ipc = ctx.omega.ipc;
        const saved = {
          firebaseAuth: auth._firebaseAuth,
          module:       auth._firebaseModule,
          broadcast:    ipc.broadcast,
          user:         auth.user,
          state:        auth.state,
        };
        const broadcasts = [];
        auth._firebaseAuth = { currentUser: { uid: 'uid-signed-in' } };
        auth._firebaseModule = { signOut: async () => { throw new Error('boom'); } };
        ipc.broadcast = (channel, payload) => {
          broadcasts.push(channel);
          return saved.broadcast.call(ipc, channel, payload);
        };
        try {
          let threw;
          try { await ipc.invoke('desktop:auth:sign-out'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/boom/);
          ctx.expect(broadcasts.includes('desktop:auth:sign-out')).toBe(false);
        } finally {
          auth._firebaseAuth = saved.firebaseAuth;
          auth._firebaseModule = saved.module;
          ipc.broadcast = saved.broadcast;
          auth.user = saved.user;
          auth.state = saved.state;
        }
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
          ctx.expect(connects[0].url).toBe('http://127.0.0.1:9099');

          // a bumped port arrives on OMEGA_AUTH_PORT (N7)
          process.env.OMEGA_AUTH_PORT = '9199';
          run(true, { ports: { auth: 9099 } });
          ctx.expect(connects.length).toBe(2);
          ctx.expect(connects[1].url).toBe('http://127.0.0.1:9199');

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
