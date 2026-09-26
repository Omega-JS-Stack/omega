// Main-layer tests for lib/context.js — session id, deviceId resolution,
// client info, geolocation cache restore + persistence.

const path = require('path');
const fs   = require('fs');
const defineCases = require('@omega.js/devkit/test/define-cases');

const MOD_PATH = path.join(__dirname, '..', '..', '..', 'lib', 'context.js');

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'context (main)',
  tests: [
    {
      name: 'context module wired on omega + initialized during boot',
      run: (ctx) => {
        ctx.expect(ctx.omega.context).toBeDefined();
        ctx.expect(ctx.omega.context._initialized).toBe(true);
      },
    },
    {
      name: 'session has id (UUID), startTime (ISO), deviceId (string)',
      run: (ctx) => {
        const s = ctx.omega.context.session;
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
        const before = ctx.omega.context.session.deviceId;
        ctx.omega.context.shutdown();
        await ctx.omega.context.initialize(ctx.omega);
        const after = ctx.omega.context.session.deviceId;
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
        const storage = ctx.omega.storage;
        const saved = storage.get('context.deviceId');

        try {
          // A wiped install: nothing stored, so the seed decides
          storage.delete('context.deviceId');
          const derived = await ctx.omega.context._resolveDeviceId();
          const mac = ctx.omega.context._readFirstMac();

          if (mac) {
            ctx.expect(derived).toBe(mac);
          } else {
            ctx.expect(derived).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          }

          // Persisted on that first resolve, and read back on every one after
          ctx.expect(storage.get('context.deviceId')).toBe(derived);

          storage.set('context.deviceId', 'stored-wins-over-the-seed');
          ctx.expect(await ctx.omega.context._resolveDeviceId()).toBe('stored-wins-over-the-seed');
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
        ctx.expect(ctx.omega.context.client.platform).toBe(expected);
      },
    },
    {
      name: 'client.arch is set',
      run: (ctx) => {
        ctx.expect(typeof ctx.omega.context.client.arch).toBe('string');
        ctx.expect(ctx.omega.context.client.arch.length > 0).toBe(true);
      },
    },
    {
      name: 'client.mobile is false on desktop',
      run: (ctx) => {
        ctx.expect(ctx.omega.context.client.mobile).toBe(false);
      },
    },
    {
      name: 'app.environment matches omega.getEnvironment()',
      run: (ctx) => {
        ctx.expect(ctx.omega.context.app.environment).toBe(ctx.omega.getEnvironment());
      },
    },
    {
      name: 'app.version matches omega.getVersion()',
      run: (ctx) => {
        ctx.expect(ctx.omega.context.app.version).toBe(ctx.omega.getVersion());
      },
    },
    {
      name: 'toJSON returns plain JSON snapshot (structured-cloneable)',
      run: (ctx) => {
        const snap = ctx.omega.context.toJSON();
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
        const mac = ctx.omega.context._readFirstMac();
        if (mac !== null) {
          ctx.expect(mac).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i);
        }
      },
    },
    {
      name: 'IPC handler desktop:context:get returns the snapshot',
      run: async (ctx) => {
        const snap = await ctx.omega.ipc.invoke('desktop:context:get');
        ctx.expect(snap.session.id).toBe(ctx.omega.context.session.id);
        ctx.expect(snap.client.platform).toBe(ctx.omega.context.client.platform);
      },
    },
  ],
});
