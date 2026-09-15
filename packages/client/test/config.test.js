const { describe, it } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

describe('Configuration & Initialization', () => {

  it('should initialize with brand-centric format', async () => {
    const Manager = getManager();
    await Manager.initialize({
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

    assert.strictEqual(Manager.config.brand?.id, 'test-brand');
    assert.strictEqual(Manager.config.brand?.name, 'Test Brand');
    assert.strictEqual(Manager.config.firebase?.app?.enabled, false);
    assert.strictEqual(Manager.config.firebase?.app?.config?.apiKey, 'test-key');
  });

  it('should merge validRedirectHosts into config', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      validRedirectHosts: ['app.example.com', 'admin.example.com'],
    });

    const hosts = Manager.config.validRedirectHosts;
    assert(Array.isArray(hosts));
    assert(hosts.includes('app.example.com'));
    assert(hosts.includes('admin.example.com'));
  });

  it('should deep-merge defaults for missing keys', async () => {
    const Manager = getManager();
    await Manager.initialize(TEST_CONFIG);

    assert.strictEqual(typeof Manager.config.buildTime, 'number');
    assert.strictEqual(Manager.config.auth?.enabled, true);
  });

  it('#817: the environment has NO default here, it is the artifact\'s own baked fact', async () => {
    const Manager = getManager();

    // The config carries exactly what was baked, never a seeded 'production'.
    await Manager.initialize({ ...TEST_CONFIG, environment: 'development' });
    assert.strictEqual(Manager.config.environment, 'development');
    assert.strictEqual(Manager.getEnvironment(), 'development');

    // A config that carries none is a broken build, and the read says so by
    // name instead of quietly answering production and talking to LIVE Firebase.
    // The service worker is off for this one boot: its registration reads the
    // same surface now, so a broken artifact fails THAT by name too, and this
    // case is about the read, not about the registration.
    const { environment, ...withoutEnvironment } = TEST_CONFIG;
    await Manager.initialize({ ...withoutEnvironment, serviceWorker: { enabled: false } });
    assert.strictEqual(Manager.config.environment, undefined, 'nothing seeded a default');
    assert.throws(() => Manager.getEnvironment(), /OMEGA_ENVIRONMENT/);
    assert.throws(() => Manager.isDevelopment(), /OMEGA_ENVIRONMENT/);
  });

  it('#377: a nulled settings blob is omitted from the Chatsy options', () => {
    // The web build's public config filter inlines `settings: null` for brands
    // that set no widget settings, and that null survives the merge. Forwarding
    // it into the chatsy package crashed its constructor (reading 'button' of
    // null), so the widget silently never booted.
    const Manager = getManager();
    assert.deepStrictEqual(Manager._chatsyOptions({ settings: null }), {});
    assert.deepStrictEqual(
      Manager._chatsyOptions({ settings: { button: { icon: 'default' } } }),
      { settings: { button: { icon: 'default' } } },
    );
  });

  it('should skip Firebase when the nested config has only empty values (framework merge artifact)', async () => {
    const Manager = getManager();

    // UJM's Jekyll config chain always merges the base template's empty-string
    // Firebase keys into Firebase-less sites - a blob like this must NOT count
    // as a Firebase config (initializing on it crashes with auth/invalid-api-key)
    await Manager.initialize({
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

    assert.strictEqual(Manager._resolveFirebaseConfig(), null);
  });

  it('should skip Firebase when cloud.config has an empty apiKey', async () => {
    const Manager = getManager();
    await Manager.initialize({
      environment: 'testing',
      brand: { id: 'test-brand', name: 'Test Brand' },
      cloud: { provider: 'firebase', config: { apiKey: '', projectId: '' } },
      sentry: { enabled: false },
    });

    assert.strictEqual(Manager._resolveFirebaseConfig(), null);
  });

  it('should resolve Firebase configs that carry a real apiKey', async () => {
    const Manager = getManager();
    await Manager.initialize({
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

    const resolved = Manager._resolveFirebaseConfig();
    assert(resolved);
    assert.strictEqual(resolved.apiKey, 'test-key');
  });
  // #894: every surface hands the client the SAME resolved subset now
  // (OMEGA_BUILD_JSON.config, straight off omega.json5's canonical shape), so
  // the mapping that used to live in web's engine.js, web's foot.html and the
  // extension's bundle task lives in ONE place: here.
  it('#894: the omega.json5 `client` blob IS this contract\'s top level', async () => {
    const Manager = getManager();
    await Manager.initialize({
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

    assert.strictEqual(Manager.config.auth.config.policy, 'authenticated');
    assert.strictEqual(Manager.config.auth.config.allowSubdomainAuth, false);
    // The defaults still fill the rest of a blob key the brand only half-authored
    assert.strictEqual(Manager.config.auth.config.redirects.unauthenticated, '/signup');
    assert.strictEqual(Manager.config.exitPopup.enabled, false);
    assert.deepStrictEqual(Manager.config.env, { flavor: 'canary' });
    // …and the blob itself is not a second home for the same keys
    assert.strictEqual(Manager.config.client, undefined);
  });

  // Read through _processConfiguration, not initialize(): a resolved `enabled`
  // boots the real Sentry SDK, and what is under test is the MAPPING.
  it('#894: monitoring.providers.sentry.dsn is the ONE sentry switch', () => {
    const config = getManager()._processConfiguration({
      brand: { id: 'test-brand' },
      monitoring: { enabled: true, providers: { sentry: { dsn: 'https://key@sentry.io/1', replaysSessionSampleRate: 0.5 } } },
    });

    assert.strictEqual(config.sentry.enabled, true);
    assert.strictEqual(config.sentry.config.dsn, 'https://key@sentry.io/1');
    assert.strictEqual(config.sentry.config.replaysSessionSampleRate, 0.5);
  });

  it('#894: no canonical dsn means reporting OFF, and a legacy client.sentry blob still wins that', () => {
    const off = getManager()._processConfiguration({
      brand: { id: 'test-brand' },
      monitoring: { enabled: true, providers: { sentry: {} } },
    });
    assert.strictEqual(off.sentry.enabled, false);

    // #485 part 3: a brand still parked at the legacy home keeps reporting
    // until the one-time migration moves it.
    const legacy = getManager()._processConfiguration({
      brand: { id: 'test-brand' },
      client: { sentry: { enabled: true, config: { dsn: 'https://legacy@sentry.io/2' } } },
      monitoring: { enabled: true, providers: { sentry: {} } },
    });
    assert.strictEqual(legacy.sentry.enabled, true);
    assert.strictEqual(legacy.sentry.config.dsn, 'https://legacy@sentry.io/2');
  });

  it('#894: a canonical dsn OUTRANKS a legacy client.sentry blob', () => {
    const config = getManager()._processConfiguration({
      brand: { id: 'test-brand' },
      client: { sentry: { enabled: false, config: { dsn: 'https://legacy@sentry.io/2' } } },
      monitoring: { enabled: true, providers: { sentry: { dsn: 'https://canonical@sentry.io/1' } } },
    });

    assert.strictEqual(config.sentry.enabled, true);
    assert.strictEqual(config.sentry.config.dsn, 'https://canonical@sentry.io/1');
  });

  // #896: a surface that CANNOT be sniffed bakes its own `runtime` fact, and
  // the client takes it. A packaged Electron renderer is a browser with no
  // Electron globals of its own, so the sniff below it answers 'web' and every
  // runtime-gated read (device.isExtension, analytics' supported runtimes, the
  // html data-runtime stamp) was told the wrong surface.
  it('#896: a baked config.runtime wins over the sniff', async () => {
    const Manager = getManager();
    await Manager.initialize({ ...TEST_CONFIG, runtime: 'electron' });

    assert.strictEqual(Manager.utilities().getRuntime(), 'electron');
  });

  it('#896: with no baked runtime, the sniff still answers (web in a plain browser)', async () => {
    const Manager = getManager();
    await Manager.initialize({ ...TEST_CONFIG });

    assert.strictEqual(Manager.utilities().getRuntime(), 'web');
  });
});
