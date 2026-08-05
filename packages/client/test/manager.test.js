const { describe, it, before, afterEach } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

describe('Manager Methods', () => {

  it('should detect development environment', async () => {
    const Manager = getManager();
    await Manager.initialize({ ...TEST_CONFIG, environment: 'development' });
    assert.strictEqual(Manager.isDevelopment(), true);
  });

  it('should detect production environment', async () => {
    const Manager = getManager();
    await Manager.initialize({ ...TEST_CONFIG, environment: 'production' });
    assert.strictEqual(Manager.isDevelopment(), false);
  });

  it('should validate redirect URLs for current host', async () => {
    const Manager = getManager();
    await Manager.initialize(TEST_CONFIG);
    assert.strictEqual(Manager.isValidRedirectUrl('http://localhost:3000/page'), true);
  });

  it('should validate path-relative redirect URLs against the page origin (#160)', async () => {
    const Manager = getManager();
    await Manager.initialize(TEST_CONFIG);
    assert.strictEqual(Manager.isValidRedirectUrl('/pricing'), true);
    assert.strictEqual(Manager.isValidRedirectUrl('/dashboard/account?tab=billing'), true);
    // Absolute same-host keeps working, cross-host stays rejected in both forms
    assert.strictEqual(Manager.isValidRedirectUrl('http://localhost:3000/pricing'), true);
    assert.strictEqual(Manager.isValidRedirectUrl('https://evil.com/pricing'), false);
    assert.strictEqual(Manager.isValidRedirectUrl('//evil.com/pricing'), false);
    assert.strictEqual(Manager.isValidRedirectUrl('not-a-url'), false);
  });

  it('should reject redirect URLs for unknown hosts', () => {
    assert.strictEqual(getManager().isValidRedirectUrl('http://evil.com'), false);
  });

  it('should allow redirect URLs for configured hosts', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      validRedirectHosts: ['trusted.com'],
    });
    assert.strictEqual(Manager.isValidRedirectUrl('http://trusted.com/callback'), true);
  });

  it('should reject malformed redirect URLs', () => {
    assert.strictEqual(getManager().isValidRedirectUrl('not-a-url'), false);
  });

  it('should allow loopback redirect URLs on any port when site runs in development', async () => {
    const Manager = getManager();
    await Manager.initialize({ ...TEST_CONFIG, environment: 'development' });
    assert.strictEqual(Manager.isValidRedirectUrl('http://127.0.0.1:49152/auth/token?state=abc'), true);
    assert.strictEqual(Manager.isValidRedirectUrl('http://localhost:49152/auth/token'), true);
    assert.strictEqual(Manager.isValidRedirectUrl('http://[::1]:49152/auth/token'), true);
  });

  it('should reject loopback redirect URLs on foreign ports in production', async () => {
    const Manager = getManager();
    await Manager.initialize({ ...TEST_CONFIG, environment: 'production' });
    assert.strictEqual(Manager.isValidRedirectUrl('http://127.0.0.1:49152/auth/token'), false);
    // Same-host loopback still passes via the host check, not the dev branch
    assert.strictEqual(Manager.isValidRedirectUrl('http://localhost:3000/page'), true);
  });

  it('should return Functions URL for production', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
    });
    assert.strictEqual(Manager.getFunctionsUrl(), 'https://us-central1-my-project.cloudfunctions.net');
  });

  it('should return Functions URL for development', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
    });
    assert.strictEqual(Manager.getFunctionsUrl(), 'http://localhost:5001/my-project/us-central1');
  });

  it('should allow overriding environment in getFunctionsUrl', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
    });
    assert.strictEqual(Manager.getFunctionsUrl('development'), 'http://localhost:5001/my-project/us-central1');
  });

  it('should throw when getFunctionsUrl called without projectId', async () => {
    const Manager = getManager();
    await Manager.initialize(TEST_CONFIG);
    assert.throws(() => Manager.getFunctionsUrl(), /project ID/i);
  });

  it('should return API URL for development', async () => {
    const Manager = getManager();
    await Manager.initialize({ ...TEST_CONFIG, environment: 'development' });
    assert.strictEqual(Manager.getApiUrl(), 'https://localhost:5002');
  });

  it('should derive the production API URL from brand.url, never authDomain (wave-5 F9)', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      brand: { ...TEST_CONFIG.brand, url: 'https://playground.omegajs.dev' },
      // authDomain is an auth-only concern (the brand host, with /__/auth/*
      // self-hosted at build time) — the API base never derives from it.
      firebase: { app: { enabled: false, config: { authDomain: 'example.firebaseapp.com' } } },
    });
    assert.strictEqual(Manager.getApiUrl(), 'https://api.playground.omegajs.dev');
  });
});

describe('Module Getters', () => {

  before(async () => {
    await getManager().initialize(TEST_CONFIG);
  });

  it('should return storage module', () => { assert(getManager().storage()); });
  it('should return auth module', () => { assert(getManager().auth()); });
  it('should return bindings module', () => { assert(getManager().bindings()); });
  it('should return firestore module', () => { assert(getManager().firestore()); });
  it('should return notifications module', () => { assert(getManager().notifications()); });
  it('should return serviceWorker module', () => { assert(getManager().serviceWorker()); });
  it('should return sentry module', () => { assert(getManager().sentry()); });
  it('should return device module', () => { assert(getManager().device()); });
  it('should return dom module', () => { assert(getManager().dom()); });
  it('should return utilities module', () => { assert(getManager().utilities()); });
});

describe('Dev ports (N7)', () => {

  afterEach(() => {
    delete global.window.__OMEGA_DEV_PORTS__;
  });

  it('should read dev.ports from the baked chrome for functions + api URLs', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
      dev: { ports: { functions: 5003, hosting: 5004 } },
    });
    assert.strictEqual(Manager.getFunctionsUrl(), 'http://localhost:5003/my-project/us-central1');
    assert.strictEqual(Manager.getApiUrl(), 'http://127.0.0.1:5004');
  });

  it('should let the runtime channel (window.__OMEGA_DEV_PORTS__) win over the chrome', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
      dev: { ports: { functions: 5003, hosting: 5004 } },
    });
    global.window.__OMEGA_DEV_PORTS__ = { functions: 5103, hosting: 5104 };
    assert.strictEqual(Manager.getFunctionsUrl(), 'http://localhost:5103/my-project/us-central1');
    assert.strictEqual(Manager.getApiUrl(), 'http://127.0.0.1:5104');
  });

  it('should prefer an https (mkcert proxy) entry over plain-http hosting', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      dev: { ports: { https: 5443, hosting: 5004 } },
    });
    assert.strictEqual(Manager.getApiUrl(), 'https://localhost:5443');
  });

  it('should point the auth emulator at the SITE origin when the dev server proxies it (#156)', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      dev: { ports: { auth: 9099 }, authEmulatorProxy: true },
    });
    // Same-origin is the whole point: the OAuth handler's sessionStorage and
    // the SDK's helper iframe land in the page's own storage partition
    assert.strictEqual(Manager._authEmulatorUrl(), 'http://localhost:3000');
  });

  it('should point the auth emulator at its own port when no proxy is declared', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      dev: { ports: { auth: 9199 } },
    });
    assert.strictEqual(Manager._authEmulatorUrl(), 'http://localhost:9199');
  });

  it('should keep the classic assumptions when no map is provided', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
    });
    assert.strictEqual(Manager.getApiUrl(), 'https://localhost:5002');
    assert.strictEqual(Manager.getFunctionsUrl(), 'http://localhost:5001/my-project/us-central1');
  });

  it('should version-check /build.json only — the retired npm-build shape carries no timestamp (#148)', async () => {
    const Manager = getManager();
    await Manager.initialize({
      ...TEST_CONFIG,
      environment: 'production',
      buildTime: '2020-01-01T00:00:00.000Z',
    });

    const urls = [];
    const originalFetch = global.fetch;
    const originalReload = global.window.location.reload;
    let reloads = 0;
    global.window.location.reload = () => { reloads++; };

    try {
      // The retired shape: fetched, parsed, and rejected — no /@output/ probe
      global.fetch = async (url) => {
        urls.push(url);
        return { ok: true, json: async () => ({ 'npm-build': { timestamp: new Date(Date.now() + 86400000).toISOString() } }) };
      };
      await Manager._checkVersion();
      assert.strictEqual(urls.length, 1, 'exactly one path is probed');
      assert.ok(urls[0].startsWith('/build.json?cb='), '/build.json is the one path');
      assert.strictEqual(reloads, 0, 'the retired key never reloads the page');

      // The current shape: a newer timestamp reloads
      global.fetch = async () => ({ ok: true, json: async () => ({ timestamp: new Date(Date.now() + 86400000).toISOString() }) });
      await Manager._checkVersion();
      assert.strictEqual(reloads, 1, 'a newer build.json timestamp reloads');
    } finally {
      global.fetch = originalFetch;
      global.window.location.reload = originalReload;
    }
  });
});
