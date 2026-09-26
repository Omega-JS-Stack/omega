// Main-process tests for lib/auth-persistence.js (pluggable session vault) and
// lib/auth.js's desktop:auth:account-resolved intake (renderer → main account).
// The safeStorage strategy runs REAL (OS keychain + real file under userData) when
// encryption is available in the test environment; adapter logic is covered against
// a real in-memory strategy either way.

const authPersistence = require('../../../lib/auth-persistence.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

function fakeStrategy() {
  const store = new Map();
  return {
    name: 'fake',
    store,
    async available() { return true; },
    async setItem(k, v) { store.set(k, v); },
    async getItem(k) { return store.has(k) ? store.get(k) : null; },
    async removeItem(k) { store.delete(k); },
  };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'auth-persistence (main)',
  tests: [
    {
      name: 'resolve(): a test run is none, whatever the config says',
      run: async (ctx) => {
        const omega = ctx.omega;
        ctx.expect(omega.isTesting()).toBe(true);
        omega.config.omega = omega.config.omega || {};
        const orig = omega.config.omega.authPersistence;
        try {
          // Unset, and explicitly asking for the vault, both land on none: the harness
          // never signs a real user in, so it never asks the OS keychain
          // ([#907](https://github.com/Omega-JS-Stack/omega/issues/907)).
          delete omega.config.omega.authPersistence;
          ctx.expect(await authPersistence.resolve(omega)).toBeNull();
          ctx.expect(authPersistence.getActive()).toBeNull();

          omega.config.omega.authPersistence = 'safeStorage';
          ctx.expect(await authPersistence.resolve(omega)).toBeNull();

          omega.config.omega.authPersistence = 'none';
          ctx.expect(await authPersistence.resolve(omega)).toBeNull();
        } finally {
          if (orig !== undefined) omega.config.omega.authPersistence = orig;
          else delete omega.config.omega.authPersistence;
          await authPersistence.resolve(omega); // restore the active strategy for later suites
        }
      },
    },
    {
      name: 'register(): validates the strategy surface and adds it to the registry',
      run: async (ctx) => {
        ctx.expect(() => authPersistence.register('bad', {})).toThrow(/must implement/);

        authPersistence.register('desktop-test-custom', fakeStrategy());
        try {
          // Selection by config is proven at the build layer, on a production omega instance:
          // under test mode resolve() answers none before it reads a thing.
          ctx.expect(authPersistence._strategies['desktop-test-custom'].name).toBe('desktop-test-custom');
          ctx.expect(await authPersistence._strategies['desktop-test-custom'].available()).toBe(true);
        } finally {
          delete authPersistence._strategies['desktop-test-custom'];
        }
      },
    },
    {
      name: 'firebase adapter: _set/_get/_remove round-trip JSON blobs over the strategy',
      run: async (ctx) => {
        const strategy = fakeStrategy();
        const PersistenceClass = authPersistence.buildFirebasePersistence(strategy);
        const p = new PersistenceClass();

        ctx.expect(PersistenceClass.type).toBe('LOCAL');
        ctx.expect(p.type).toBe('LOCAL');
        ctx.expect(await p._isAvailable()).toBe(true);

        const blob = { uid: 'u1', stsTokenManager: { refreshToken: 'rt' } };
        await p._set('firebase:authUser:key:omega-auth', blob);
        ctx.expect(await p._get('firebase:authUser:key:omega-auth')).toEqual(blob);

        await p._remove('firebase:authUser:key:omega-auth');
        ctx.expect(await p._get('firebase:authUser:key:omega-auth')).toBeNull();
        ctx.expect(await p._get('never-set')).toBeNull();
      },
    },
    {
      name: 'safeStorage strategy: real encrypt/decrypt round-trip + garbage tolerance',
      run: async (ctx) => {
        const { safeStorage } = require('electron');
        if (!safeStorage?.isEncryptionAvailable?.()) {
          return; // OS vault unavailable in this environment — round-trip covered where it is
        }
        const s = authPersistence._strategies.safeStorage;
        const KEY = 'desktop-test-roundtrip';
        try {
          await s.setItem(KEY, '{"hello":"world"}');
          ctx.expect(await s.getItem(KEY)).toBe('{"hello":"world"}');

          // On-disk value is ciphertext, not the plaintext.
          const fs = require('fs');
          const raw = fs.readFileSync(s._filePath(), 'utf8');
          ctx.expect(raw.includes('hello')).toBe(false);

          // Garbage ciphertext → null (treated as signed out), not a throw.
          const map = JSON.parse(raw);
          map[KEY] = Buffer.from('not-ciphertext').toString('base64');
          fs.writeFileSync(s._filePath(), JSON.stringify(map));
          ctx.expect(await s.getItem(KEY)).toBeNull();
        } finally {
          await s.removeItem(KEY);
        }
      },
    },
    {
      name: 'auth account-resolved intake: uid-guarded, lands a User, broadcasts { document } once per change, dropped on sign-out',
      run: async (ctx) => {
        const omega = ctx.omega;
        const auth = omega.auth;
        const origAuth = auth._firebaseAuth;
        const origBroadcast = omega.ipc.broadcast;
        const broadcasts = [];
        omega.ipc.broadcast = (ch, payload) => { if (ch === 'desktop:auth:plan-changed') broadcasts.push(payload); };

        // What a signed-in renderer pushes: its User's stored document (resolved,
        // metadata stamped) and its identity
        const { User } = require('@omega.js/account');
        const IDENTITY = { uid: 'u1', email: 'x@y.z', displayName: 'X', photoURL: null, emailVerified: true };
        const DOCUMENT = new User({ subscription: { product: { id: 'premium' }, status: 'active' }, roles: { betaTester: true } }, IDENTITY).toJSON();

        try {
          // Main signed out → any push is rejected, `user` stays signed out.
          auth._firebaseAuth = { currentUser: null };
          let res = await omega.ipc.invoke('desktop:auth:account-resolved', { uid: 'u1', document: DOCUMENT, identity: IDENTITY });
          ctx.expect(res.accepted).toBe(false);
          ctx.expect(auth.user.authenticated).toBe(false);
          ctx.expect(auth.user.plan).toBe('basic');

          // Matching uid → main builds its User from the WHOLE document + broadcasts it.
          auth._firebaseAuth = { currentUser: { uid: 'u1', email: 'x@y.z' } };
          res = await omega.ipc.invoke('desktop:auth:account-resolved', { uid: 'u1', document: DOCUMENT, identity: IDENTITY });
          ctx.expect(res.accepted).toBe(true);
          ctx.expect(auth.user.uid).toBe('u1');
          ctx.expect(auth.user.plan).toBe('premium');
          ctx.expect(auth.user.roles.betaTester).toBe(true);
          ctx.expect(auth.user.profile.displayName).toBe('X');
          ctx.expect(broadcasts.length).toBe(1);
          ctx.expect(broadcasts[0]).toEqual({ document: auth.user.toJSON() });

          // Identical push → accepted but NO second broadcast.
          await omega.ipc.invoke('desktop:auth:account-resolved', { uid: 'u1', document: DOCUMENT, identity: IDENTITY });
          ctx.expect(broadcasts.length).toBe(1);

          // Mismatched uid (stale renderer) → dropped, account intact.
          res = await omega.ipc.invoke('desktop:auth:account-resolved', { uid: 'other', document: { subscription: { product: { id: 'max' }, status: 'active' } } });
          ctx.expect(res.accepted).toBe(false);
          ctx.expect(auth.user.plan).toBe('premium');

          // Sign-out drops the account.
          auth._handleAuthStateChange(null);
          ctx.expect(auth.user.authenticated).toBe(false);
          ctx.expect(auth.user.plan).toBe('basic');
        } finally {
          // A case that failed midway still leaves main signed out for the suites after it
          if (auth.user.authenticated) auth._handleAuthStateChange(null);
          auth._firebaseAuth = origAuth;
          omega.ipc.broadcast = origBroadcast;
        }
      },
    },
  ],
});
