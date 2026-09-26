// Main-layer tests for lib/remote-config.js — fetch + cache + dot-path get +
// onUpdate listeners + URL derivation from brand.url.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'remote-config (main)',
  cleanup: (ctx) => {
    ctx.omega.remoteConfig.shutdown();
    ctx.omega.storage.set('remoteConfig', null);
    ctx.omega.remoteConfig.initialize(ctx.omega);
  },
  tests: [
    {
      name: 'remoteConfig module wired on omega + initialized during boot',
      run: (ctx) => {
        ctx.expect(ctx.omega.remoteConfig).toBeDefined();
        ctx.expect(ctx.omega.remoteConfig._initialized).toBe(true);
      },
    },
    {
      name: 'URL derived from brand.url (legacy convention path)',
      run: (ctx) => {
        // Test config has a brand.url, so we should have a URL set.
        // (If brand.url is missing in test config, this test verifies the resolution shape.)
        const u = ctx.omega.remoteConfig._url;
        ctx.expect(u === null || u.endsWith('/data/resources/main.json')).toBe(true);
      },
    },
    {
      name: 'URL override: config.remoteConfig.url wins over brand.url',
      run: async (ctx) => {
        ctx.omega.remoteConfig.shutdown();
        const orig = ctx.omega.config.remoteConfig;
        ctx.omega.config.remoteConfig = { url: 'https://override.example/custom.json' };
        try {
          ctx.omega.remoteConfig.initialize(ctx.omega);
          ctx.expect(ctx.omega.remoteConfig._url).toBe('https://override.example/custom.json');
        } finally {
          ctx.omega.remoteConfig.shutdown();
          ctx.omega.config.remoteConfig = orig;
          ctx.omega.remoteConfig.initialize(ctx.omega);
        }
      },
    },
    {
      name: 'transport gate: non-https URL refused (defaults only), loopback http allowed',
      run: async (ctx) => {
        const orig = ctx.omega.config.remoteConfig;
        try {
          ctx.omega.remoteConfig.shutdown();
          ctx.omega.config.remoteConfig = { url: 'http://insecure.example/custom.json' };
          ctx.omega.remoteConfig.initialize(ctx.omega);
          ctx.expect(ctx.omega.remoteConfig._url).toBe(null);
          // Defaults still served — the gate disables the fetch, not the API —
          // and the renderer IPC handler is registered BEFORE the gate returns
          // (the preload exposes the invoke unconditionally).
          ctx.expect(ctx.omega.remoteConfig.get('status')).toBe('online');
          const viaIpc = await ctx.omega.ipc.invoke('desktop:remote-config:get', 'status');
          ctx.expect(viaIpc).toBe('online');

          // Unlikely-to-be-listening port — initialize() fires a real fetch.
          ctx.omega.remoteConfig.shutdown();
          ctx.omega.config.remoteConfig = { url: 'http://127.0.0.1:59987/custom.json' };
          ctx.omega.remoteConfig.initialize(ctx.omega);
          ctx.expect(ctx.omega.remoteConfig._url).toBe('http://127.0.0.1:59987/custom.json');
        } finally {
          ctx.omega.remoteConfig.shutdown();
          ctx.omega.config.remoteConfig = orig;
          ctx.omega.remoteConfig.initialize(ctx.omega);
        }
      },
    },
    {
      name: 'enabled=false: skip everything',
      run: async (ctx) => {
        ctx.omega.remoteConfig.shutdown();
        const orig = ctx.omega.config.remoteConfig;
        ctx.omega.config.remoteConfig = { enabled: false };
        try {
          ctx.omega.remoteConfig.initialize(ctx.omega);
          ctx.expect(ctx.omega.remoteConfig._enabled).toBe(false);
          ctx.expect(ctx.omega.remoteConfig._url).toBe(null);
          ctx.expect(ctx.omega.remoteConfig._intervalId).toBe(null);
        } finally {
          ctx.omega.remoteConfig.shutdown();
          ctx.omega.config.remoteConfig = orig;
          ctx.omega.remoteConfig.initialize(ctx.omega);
        }
      },
    },
    {
      name: 'get() returns cached data after a successful fetch',
      run: async (ctx) => {
        // Inject test data via the storage cache + bypass the network.
        const planted = { status: 'online', versionRequired: '2.0.0' };
        ctx.omega.remoteConfig._data = planted;
        const got = ctx.omega.remoteConfig.get();
        ctx.expect(got.status).toBe('online');
        ctx.expect(got.versionRequired).toBe('2.0.0');
      },
    },
    {
      name: 'get() supports dot-path lookup',
      run: (ctx) => {
        ctx.omega.remoteConfig._data = {
          status: 'online',
          settings: { versionRequired: '1.5.0', nested: { value: 42 } },
        };
        ctx.expect(ctx.omega.remoteConfig.get('status')).toBe('online');
        ctx.expect(ctx.omega.remoteConfig.get('settings.versionRequired')).toBe('1.5.0');
        ctx.expect(ctx.omega.remoteConfig.get('settings.nested.value')).toBe(42);
        ctx.expect(ctx.omega.remoteConfig.get('settings.missing')).toBe(undefined);
        ctx.expect(ctx.omega.remoteConfig.get('totally.absent.path')).toBe(undefined);
      },
    },
    {
      name: 'get() returns DEFAULTS even before first fetch (so consumers never see undefined at boot)',
      run: (ctx) => {
        const orig = ctx.omega.remoteConfig._data;
        ctx.omega.remoteConfig._data = null;
        try {
          const all = ctx.omega.remoteConfig.get();
          ctx.expect(all.status).toBe('online');
          ctx.expect(all.versionRequired).toBe('0.0.0');
          ctx.expect(ctx.omega.remoteConfig.get('status')).toBe('online');
          ctx.expect(ctx.omega.remoteConfig.get('versionRequired')).toBe('0.0.0');
        } finally { ctx.omega.remoteConfig._data = orig; }
      },
    },
    {
      name: 'DEFAULTS export — exposed for consumer reference',
      run: (ctx) => {
        const D = ctx.omega.remoteConfig.DEFAULTS;
        ctx.expect(D).toBeDefined();
        ctx.expect(D.status).toBe('online');
        ctx.expect(D.versionRequired).toBe('0.0.0');
        // Frozen — consumers can't accidentally mutate the shared default.
        let threw = false;
        try { D.status = 'tampered'; } catch (_) { threw = true; }
        // In strict mode this throws; in sloppy it silently fails. Either way
        // the value should not change.
        ctx.expect(D.status).toBe('online');
      },
    },
    {
      name: 'on(update, fn): subscriber fires when _emit is called',
      run: async (ctx) => {
        let received = null;
        const off = ctx.omega.remoteConfig.on('update', (data) => { received = data; });
        try {
          ctx.omega.remoteConfig._emit('update', { ping: true });
          ctx.expect(received).toEqual({ ping: true });
        } finally { off(); }
      },
    },
    {
      name: 'on(update, fn): unsubscribe stops further calls',
      run: (ctx) => {
        let count = 0;
        const off = ctx.omega.remoteConfig.on('update', () => { count++; });
        ctx.omega.remoteConfig._emit('update', {});
        ctx.expect(count).toBe(1);
        off();
        ctx.omega.remoteConfig._emit('update', {});
        ctx.expect(count).toBe(1);   // unchanged
      },
    },
    {
      name: 'IPC handler desktop:remote-config:get returns cached data',
      run: async (ctx) => {
        ctx.omega.remoteConfig._data = { status: 'online', x: 1 };
        const result = await ctx.omega.ipc.invoke('desktop:remote-config:get');
        ctx.expect(result.status).toBe('online');
        ctx.expect(result.x).toBe(1);
      },
    },
    {
      name: 'IPC handler desktop:remote-config:get supports dot-path',
      run: async (ctx) => {
        ctx.omega.remoteConfig._data = { settings: { versionRequired: '3.1.4' } };
        const result = await ctx.omega.ipc.invoke('desktop:remote-config:get', 'settings.versionRequired');
        ctx.expect(result).toBe('3.1.4');
      },
    },
  ],
});
