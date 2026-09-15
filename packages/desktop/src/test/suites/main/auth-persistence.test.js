// Main-process tests for lib/auth-persistence.js (pluggable session vault) and the
// bridge's desktop:auth:account-resolved intake (renderer → main plan resolution cache).
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
        const m = ctx.manager;
        ctx.expect(m.isTesting()).toBe(true);
        m.config.omega = m.config.omega || {};
        const orig = m.config.omega.authPersistence;
        try {
          // Unset, and explicitly asking for the vault, both land on none: the harness
          // never signs a real user in, so it never asks the OS keychain
          // ([#907](https://github.com/Omega-JS-Stack/omega/issues/907)).
          delete m.config.omega.authPersistence;
          ctx.expect(await authPersistence.resolve(m)).toBeNull();
          ctx.expect(authPersistence.getActive()).toBeNull();

          m.config.omega.authPersistence = 'safeStorage';
          ctx.expect(await authPersistence.resolve(m)).toBeNull();

          m.config.omega.authPersistence = 'none';
          ctx.expect(await authPersistence.resolve(m)).toBeNull();
        } finally {
          if (orig !== undefined) m.config.omega.authPersistence = orig;
          else delete m.config.omega.authPersistence;
          await authPersistence.resolve(m); // restore the active strategy for later suites
        }
      },
    },
    {
      name: 'register(): validates the strategy surface and adds it to the registry',
      run: async (ctx) => {
        ctx.expect(() => authPersistence.register('bad', {})).toThrow(/must implement/);

        authPersistence.register('desktop-test-custom', fakeStrategy());
        try {
          // Selection by config is proven at the build layer, on a production manager:
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
      name: 'bridge account-resolved intake: uid-guarded, cached, broadcast once per change, cleared on sign-out',
      run: async (ctx) => {
        const m = ctx.manager;
        const bridge = m.omega;
        const origAuth = bridge._firebaseAuth;
        const origBroadcast = m.ipc.broadcast;
        const broadcasts = [];
        m.ipc.broadcast = (ch, payload) => { if (ch === 'desktop:auth:plan-changed') broadcasts.push(payload); };
        try {
          // Main signed out → any push is rejected.
          bridge._firebaseAuth = { currentUser: null };
          let res = await m.ipc.invoke('desktop:auth:account-resolved', { uid: 'u1', resolved: { plan: 'pro', active: true } });
          ctx.expect(res.accepted).toBe(false);
          ctx.expect(bridge.getResolvedPlan()).toBeNull();

          // Matching uid → cached + broadcast.
          bridge._firebaseAuth = { currentUser: { uid: 'u1', email: 'x@y.z' } };
          res = await m.ipc.invoke('desktop:auth:account-resolved', { uid: 'u1', resolved: { plan: 'pro', active: true }, roles: { betaTester: true } });
          ctx.expect(res.accepted).toBe(true);
          ctx.expect(bridge.getResolvedPlan()).toEqual({ plan: 'pro', active: true });
          ctx.expect(bridge.getResolvedRoles()).toEqual({ betaTester: true });
          ctx.expect(broadcasts.length).toBe(1);

          // Identical push → accepted but NO second broadcast.
          await m.ipc.invoke('desktop:auth:account-resolved', { uid: 'u1', resolved: { plan: 'pro', active: true }, roles: { betaTester: true } });
          ctx.expect(broadcasts.length).toBe(1);

          // Mismatched uid (stale renderer) → dropped, cache intact.
          res = await m.ipc.invoke('desktop:auth:account-resolved', { uid: 'other', resolved: { plan: 'max', active: true } });
          ctx.expect(res.accepted).toBe(false);
          ctx.expect(bridge.getResolvedPlan()).toEqual({ plan: 'pro', active: true });

          // Sign-out clears the cache.
          bridge._handleAuthStateChange(null);
          ctx.expect(bridge.getResolvedPlan()).toBeNull();
          ctx.expect(bridge.getResolvedRoles()).toBeNull();
        } finally {
          bridge._firebaseAuth = origAuth;
          m.ipc.broadcast = origBroadcast;
          bridge._resolvedPlan = null;
          bridge._resolvedRoles = null;
        }
      },
    },
  ],
});
