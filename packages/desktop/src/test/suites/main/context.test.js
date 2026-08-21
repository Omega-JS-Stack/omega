// Main-layer tests for lib/context.js — session id, deviceId resolution,
// client info, geolocation cache restore + persistence.

const path = require('path');
const fs   = require('fs');

const MOD_PATH = path.join(__dirname, '..', '..', '..', 'lib', 'context.js');

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'context (main)',
  tests: [
    {
      name: 'context module wired on manager + initialized during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.context).toBeDefined();
        ctx.expect(ctx.manager.context._initialized).toBe(true);
      },
    },
    {
      name: 'session has id (UUID), startTime (ISO), deviceId (string)',
      run: (ctx) => {
        const s = ctx.manager.context.session;
        ctx.expect(typeof s.id).toBe('string');
        ctx.expect(s.id.length).toBe(36);
        ctx.expect(typeof s.startTime).toBe('string');
        ctx.expect(s.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        ctx.expect(typeof s.deviceId).toBe('string');
        ctx.expect(s.deviceId.length > 0).toBe(true);
      },
    },
    {
      name: 'deviceId is stable — re-init preserves the same id',
      run: async (ctx) => {
        const before = ctx.manager.context.session.deviceId;
        ctx.manager.context.shutdown();
        await ctx.manager.context.initialize(ctx.manager);
        const after = ctx.manager.context.session.deviceId;
        ctx.expect(after).toBe(before);
      },
    },
    {
      // The WIRING, not just the outcome: desktop's own walk is gone and the
      // shared derivation is what runs (#396). The behavior below is identical
      // either way, so this is the assertion that tells the two apart.
      name: 'deviceId resolution calls the shared core.deriveDeviceId, not a local walk',
      run: (ctx) => {
        const source = fs.readFileSync(MOD_PATH, 'utf8');

        // Vendored into dist at prepare time, live via the package in a linked
        // monorepo — either specifier is the same module.
        ctx.expect(/require\('(\.\.\/vendor\/analytics\/core\.js|@omega\.js\/analytics\/core)'\)/.test(source)).toBe(true);
        ctx.expect(source.includes('core.deriveDeviceId({')).toBe(true);
        ctx.expect(source.includes('seed: () => context._readFirstMac()')).toBe(true);
        ctx.expect(source.includes('const id = mac ||')).toBe(false);
      },
    },
    {
      // The derivation is @omega.js/analytics' one walk (#396); what desktop
      // owns is the pair injected into it — electron-store, and the MAC seed
      // that hands a wiped install back the id it had before.
      name: 'deviceId derives from the injected MAC seed and persists to storage',
      run: async (ctx) => {
        const storage = ctx.manager.storage;
        const saved = storage.get('context.deviceId');

        try {
          // A wiped install: nothing stored, so the seed decides
          storage.delete('context.deviceId');
          const derived = await ctx.manager.context._resolveDeviceId();
          const mac = ctx.manager.context._readFirstMac();

          if (mac) {
            ctx.expect(derived).toBe(mac);
          } else {
            ctx.expect(derived).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          }

          // Persisted on that first resolve, and read back on every one after
          ctx.expect(storage.get('context.deviceId')).toBe(derived);

          storage.set('context.deviceId', 'stored-wins-over-the-seed');
          ctx.expect(await ctx.manager.context._resolveDeviceId()).toBe('stored-wins-over-the-seed');
        } finally {
          if (saved) storage.set('context.deviceId', saved);
          else storage.delete('context.deviceId');
        }
      },
    },
    {
      name: 'client.platform is set (matches os.platform())',
      run: (ctx) => {
        const expected = require('os').platform();
        ctx.expect(ctx.manager.context.client.platform).toBe(expected);
      },
    },
    {
      name: 'client.arch is set',
      run: (ctx) => {
        ctx.expect(typeof ctx.manager.context.client.arch).toBe('string');
        ctx.expect(ctx.manager.context.client.arch.length > 0).toBe(true);
      },
    },
    {
      name: 'client.mobile is false on desktop',
      run: (ctx) => {
        ctx.expect(ctx.manager.context.client.mobile).toBe(false);
      },
    },
    {
      name: 'app.environment matches manager.getEnvironment()',
      run: (ctx) => {
        ctx.expect(ctx.manager.context.app.environment).toBe(ctx.manager.getEnvironment());
      },
    },
    {
      name: 'app.version matches manager.getVersion()',
      run: (ctx) => {
        ctx.expect(ctx.manager.context.app.version).toBe(ctx.manager.getVersion());
      },
    },
    {
      name: 'toJSON returns plain JSON snapshot (structured-cloneable)',
      run: (ctx) => {
        const snap = ctx.manager.context.toJSON();
        ctx.expect(snap.geolocation).toBeDefined();
        ctx.expect(snap.client).toBeDefined();
        ctx.expect(snap.session).toBeDefined();
        ctx.expect(snap.app).toBeDefined();
        // Must JSON-roundtrip without errors.
        const roundtripped = JSON.parse(JSON.stringify(snap));
        ctx.expect(roundtripped.session.id).toBe(snap.session.id);
      },
    },
    {
      name: '_readFirstMac returns null or a MAC-shaped string',
      run: (ctx) => {
        const mac = ctx.manager.context._readFirstMac();
        if (mac !== null) {
          ctx.expect(mac).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i);
        }
      },
    },
    {
      name: 'IPC handler desktop:context:get returns the snapshot',
      run: async (ctx) => {
        const snap = await ctx.manager.ipc.invoke('desktop:context:get');
        ctx.expect(snap.session.id).toBe(ctx.manager.context.session.id);
        ctx.expect(snap.client.platform).toBe(ctx.manager.context.client.platform);
      },
    },
  ],
};
