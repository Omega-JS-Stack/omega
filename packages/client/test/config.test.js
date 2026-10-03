const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'config',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    {
      name: 'Configuration & Initialization > should initialize with brand-centric format',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();
        await omega.initialize({
          // The one environment input a browser context has (#817), the fact every
          // OMEGA build bakes: a config assembled by hand states it too.
          environment: 'testing',
          brand: {
            id: 'test-brand',
            name: 'Test Brand',
            description: 'Test description',
            contact: { email: 'test@example.com' },
          },
          firebase: {
            app: {
              enabled: false,
              config: {
                apiKey: 'test-key',
                authDomain: 'test.firebaseapp.com',
                projectId: 'test-project',
                appId: '1:test:web:test',
                messagingSenderId: '123456789',
              },
            },
          },
          sentry: { enabled: false },
        });

        ctx.expect(omega.config.brand?.id).toBe('test-brand');
        ctx.expect(omega.config.brand?.name).toBe('Test Brand');
        ctx.expect(omega.config.firebase?.app?.enabled).toBe(false);
        ctx.expect(omega.config.firebase?.app?.config?.apiKey).toBe('test-key');
      },
    },

    {
      name: 'Configuration & Initialization > should merge validRedirectHosts into config',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();
        await omega.initialize({
          ...TEST_CONFIG,
          validRedirectHosts: ['app.example.com', 'admin.example.com'],
        });

        const hosts = omega.config.validRedirectHosts;
        ctx.expect(Array.isArray(hosts)).toBeTruthy();
        ctx.expect(hosts.includes('app.example.com')).toBeTruthy();
        ctx.expect(hosts.includes('admin.example.com')).toBeTruthy();
      },
    },

    {
      name: 'Configuration & Initialization > should deep-merge defaults for missing keys',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();
        await omega.initialize(TEST_CONFIG);

        ctx.expect(typeof omega.config.buildTime).toBe('number');
        ctx.expect(omega.config.auth?.enabled).toBe(true);
      },
    },

    {
      name: 'Configuration & Initialization > #817: the environment has NO default here, it is the artifact\'s own baked fact',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();

        // The config carries exactly what was baked, never a seeded 'production'.
        await omega.initialize({ ...TEST_CONFIG, environment: 'development' });
        ctx.expect(omega.config.environment).toBe('development');
        ctx.expect(omega.getEnvironment()).toBe('development');

        // A config that carries none is a broken build, and the read says so by
        // name instead of quietly answering production and talking to LIVE Firebase.
        // The service worker is off for this one boot: its registration reads the
        // same surface now, so a broken artifact fails THAT by name too, and this
        // case is about the read, not about the registration.
        const { environment, ...withoutEnvironment } = TEST_CONFIG;
        await omega.initialize({ ...withoutEnvironment, serviceWorker: { enabled: false } });
        ctx.expect(omega.config.environment, 'nothing seeded a default').toBe(undefined);
        ctx.expect(() => omega.getEnvironment()).toThrow(/OMEGA_ENVIRONMENT/);
        ctx.expect(() => omega.isDevelopment()).toThrow(/OMEGA_ENVIRONMENT/);
      },
    },

    {
      name: 'Configuration & Initialization > #377: a nulled settings blob is omitted from the Chatsy options',
      run: async (ctx) => {
        await beforeEachHook();
        // The web build's public config filter inlines `settings: null` for brands
        // that set no widget settings, and that null survives the merge. Forwarding
        // it into the chatsy package crashed its constructor (reading 'button' of
        // null), so the widget silently never booted.
        const omega = getOmega();
        ctx.expect(omega._chatsyOptions({ settings: null })).toEqual({});
        ctx.expect(omega._chatsyOptions({ settings: { button: { icon: 'default' } } })).toEqual({ settings: { button: { icon: 'default' } } });
      },
    },

    {
      name: 'Configuration & Initialization > should skip Firebase when the nested config has only empty values (framework merge artifact)',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();

        // UJM's Jekyll config chain always merges the base template's empty-string
        // Firebase keys into Firebase-less sites - a blob like this must NOT count
        // as a Firebase config (initializing on it crashes with auth/invalid-api-key)
        await omega.initialize({
          environment: 'testing',
          brand: { id: 'test-brand', name: 'Test Brand' },
          firebase: {
            app: {
              enabled: true,
              config: {
                apiKey: '',
                authDomain: '',
                databaseURL: '',
                projectId: '',
                storageBucket: '',
                messagingSenderId: '',
                appId: '',
                measurementId: '',
              },
            },
          },
          sentry: { enabled: false },
        });

        ctx.expect(omega._resolveFirebaseConfig()).toBe(null);
      },
    },

    {
      name: 'Configuration & Initialization > should skip Firebase when cloud.config has an empty apiKey',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();
        await omega.initialize({
          environment: 'testing',
          brand: { id: 'test-brand', name: 'Test Brand' },
          cloud: { provider: 'firebase', config: { apiKey: '', projectId: '' } },
          sentry: { enabled: false },
        });

        ctx.expect(omega._resolveFirebaseConfig()).toBe(null);
      },
    },

    {
      name: 'Configuration & Initialization > should resolve Firebase configs that carry a real apiKey',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();
        await omega.initialize({
          environment: 'testing',
          brand: { id: 'test-brand', name: 'Test Brand' },
          firebase: {
            app: {
              enabled: false,
              config: {
                apiKey: 'test-key',
                authDomain: 'test.firebaseapp.com',
                projectId: 'test-project',
              },
            },
          },
          sentry: { enabled: false },
        });

        const resolved = omega._resolveFirebaseConfig();
        ctx.expect(resolved).toBeTruthy();
        ctx.expect(resolved.apiKey).toBe('test-key');
      },
    },

    // #894: every surface hands the client the SAME resolved subset now
    // (OMEGA_BUILD_JSON.config, straight off omega.json5's canonical shape), so
    // the mapping that used to live in web's engine.js, web's foot.html and the
    // extension's bundle task lives in ONE place: here.
    {
      name: 'Configuration & Initialization > #894: the omega.json5 `client` blob IS this contract\'s top level',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();
        await omega.initialize({
          environment: 'testing',
          brand: { id: 'test-brand' },
          client: {
            auth: { config: { policy: 'authenticated', allowSubdomainAuth: false } },
            exitPopup: { enabled: false },
            env: { flavor: 'canary' },
          },
          cloud: { provider: 'firebase', config: { apiKey: '' } },
          monitoring: { enabled: true, providers: { sentry: {} } },
        });

        ctx.expect(omega.config.auth.config.policy).toBe('authenticated');
        ctx.expect(omega.config.auth.config.allowSubdomainAuth).toBe(false);
        // The defaults still fill the rest of a blob key the brand only half-authored
        ctx.expect(omega.config.auth.config.redirects.unauthenticated).toBe('/signup');
        ctx.expect(omega.config.exitPopup.enabled).toBe(false);
        ctx.expect(omega.config.env).toEqual({ flavor: 'canary' });
        // …and the blob itself is not a second home for the same keys
        ctx.expect(omega.config.client).toBe(undefined);
      },
    },

    // Read through _processConfiguration, not initialize(): a resolved `enabled`
    // boots the real Sentry SDK, and what is under test is the MAPPING.
    {
      name: 'Configuration & Initialization > #894: monitoring.providers.sentry.dsn is the ONE sentry switch',
      run: async (ctx) => {
        await beforeEachHook();
        const config = getOmega()._processConfiguration({
          brand: { id: 'test-brand' },
          monitoring: { enabled: true, providers: { sentry: { dsn: 'https://key@sentry.io/1', replaysSessionSampleRate: 0.5 } } },
        });

        ctx.expect(config.sentry.enabled).toBe(true);
        ctx.expect(config.sentry.config.dsn).toBe('https://key@sentry.io/1');
        ctx.expect(config.sentry.config.replaysSessionSampleRate).toBe(0.5);
      },
    },

    {
      name: 'Configuration & Initialization > #894: no canonical dsn means reporting OFF, and a legacy client.sentry blob still wins that',
      run: async (ctx) => {
        await beforeEachHook();
        const off = getOmega()._processConfiguration({
          brand: { id: 'test-brand' },
          monitoring: { enabled: true, providers: { sentry: {} } },
        });
        ctx.expect(off.sentry.enabled).toBe(false);

        // #485 part 3: a brand still parked at the legacy home keeps reporting
        // until the one-time migration moves it.
        const legacy = getOmega()._processConfiguration({
          brand: { id: 'test-brand' },
          client: { sentry: { enabled: true, config: { dsn: 'https://legacy@sentry.io/2' } } },
          monitoring: { enabled: true, providers: { sentry: {} } },
        });
        ctx.expect(legacy.sentry.enabled).toBe(true);
        ctx.expect(legacy.sentry.config.dsn).toBe('https://legacy@sentry.io/2');
      },
    },

    {
      name: 'Configuration & Initialization > #894: a canonical dsn OUTRANKS a legacy client.sentry blob',
      run: async (ctx) => {
        await beforeEachHook();
        const config = getOmega()._processConfiguration({
          brand: { id: 'test-brand' },
          client: { sentry: { enabled: false, config: { dsn: 'https://legacy@sentry.io/2' } } },
          monitoring: { enabled: true, providers: { sentry: { dsn: 'https://canonical@sentry.io/1' } } },
        });

        ctx.expect(config.sentry.enabled).toBe(true);
        ctx.expect(config.sentry.config.dsn).toBe('https://canonical@sentry.io/1');
      },
    },

    // #896: a surface that CANNOT be sniffed bakes its own `runtime` fact, and
    // the client takes it. A packaged Electron renderer is a browser with no
    // Electron globals of its own, so the sniff below it answers 'web' and every
    // runtime-gated read (device.isExtension, analytics' supported runtimes, the
    // html data-runtime stamp) was told the wrong surface.
    {
      name: 'Configuration & Initialization > #896: a baked config.runtime wins over the sniff',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();
        await omega.initialize({ ...TEST_CONFIG, runtime: 'electron' });

        ctx.expect(omega.utilities.getRuntime()).toBe('electron');
      },
    },

    {
      name: 'Configuration & Initialization > #896: with no baked runtime, the sniff still answers (web in a plain browser)',
      run: async (ctx) => {
        await beforeEachHook();
        const omega = getOmega();
        await omega.initialize({ ...TEST_CONFIG });

        ctx.expect(omega.utilities.getRuntime()).toBe('web');
      },
    },
  ],
});
