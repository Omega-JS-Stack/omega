const { describe, it, before, afterEach } = require('node:test');
const { getOmega, TEST_CONFIG, assert } = require('./helpers.js');

describe('Omega methods', () => {

  it('should detect development environment', async () => {
    const omega = getOmega();
    await omega.initialize({ ...TEST_CONFIG, environment: 'development' });
    assert.strictEqual(omega.isDevelopment(), true);
  });

  it('should detect production environment', async () => {
    const omega = getOmega();
    await omega.initialize({ ...TEST_CONFIG, environment: 'production' });
    assert.strictEqual(omega.isDevelopment(), false);
  });

  it('#817: the full environment surface, derived from the ONE baked input', async () => {
    const omega = getOmega();

    // The same four calls every other OMEGA target answers, from the same
    // module. The three checks DERIVE from getEnvironment(), so exactly one is
    // true in each lane and isProduction() is a real positive check.
    for (const name of ['development', 'testing', 'production']) {
      await omega.initialize({ ...TEST_CONFIG, environment: name });
      assert.strictEqual(omega.getEnvironment(), name);
      assert.strictEqual(omega.isDevelopment(), name === 'development', `isDevelopment in ${name}`);
      assert.strictEqual(omega.isTesting(), name === 'testing', `isTesting in ${name}`);
      assert.strictEqual(omega.isProduction(), name === 'production', `isProduction in ${name}`);
      const trueCount = [omega.isDevelopment(), omega.isTesting(), omega.isProduction()].filter(Boolean).length;
      assert.strictEqual(trueCount, 1, `exactly one is*() true in ${name}`);
    }
  });

  it('should validate redirect URLs for current host', async () => {
    const omega = getOmega();
    await omega.initialize(TEST_CONFIG);
    assert.strictEqual(omega.isValidRedirectUrl('http://localhost:3000/page'), true);
  });

  it('should validate path-relative redirect URLs against the page origin (#160)', async () => {
    const omega = getOmega();
    await omega.initialize(TEST_CONFIG);
    assert.strictEqual(omega.isValidRedirectUrl('/pricing'), true);
    assert.strictEqual(omega.isValidRedirectUrl('/dashboard/account?tab=billing'), true);
    // Absolute same-host keeps working, cross-host stays rejected in both forms
    assert.strictEqual(omega.isValidRedirectUrl('http://localhost:3000/pricing'), true);
    assert.strictEqual(omega.isValidRedirectUrl('https://evil.com/pricing'), false);
    assert.strictEqual(omega.isValidRedirectUrl('//evil.com/pricing'), false);
    assert.strictEqual(omega.isValidRedirectUrl('not-a-url'), false);
  });

  it('should reject redirect URLs for unknown hosts', () => {
    assert.strictEqual(getOmega().isValidRedirectUrl('http://evil.com'), false);
  });

  it('should allow redirect URLs for configured hosts', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      validRedirectHosts: ['trusted.com'],
    });
    assert.strictEqual(omega.isValidRedirectUrl('http://trusted.com/callback'), true);
  });

  it('should reject malformed redirect URLs', () => {
    assert.strictEqual(getOmega().isValidRedirectUrl('not-a-url'), false);
  });

  it('should allow loopback redirect URLs on any port when site runs in development', async () => {
    const omega = getOmega();
    await omega.initialize({ ...TEST_CONFIG, environment: 'development' });
    assert.strictEqual(omega.isValidRedirectUrl('http://127.0.0.1:49152/auth/token?state=abc'), true);
    assert.strictEqual(omega.isValidRedirectUrl('http://localhost:49152/auth/token'), true);
    assert.strictEqual(omega.isValidRedirectUrl('http://[::1]:49152/auth/token'), true);
  });

  it('should reject loopback redirect URLs on foreign ports in production', async () => {
    const omega = getOmega();
    await omega.initialize({ ...TEST_CONFIG, environment: 'production' });
    assert.strictEqual(omega.isValidRedirectUrl('http://127.0.0.1:49152/auth/token'), false);
    // Same-host loopback still passes via the host check, not the dev branch
    assert.strictEqual(omega.isValidRedirectUrl('http://localhost:3000/page'), true);
  });

  it('should return Functions URL for production', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
    });
    assert.strictEqual(omega.getFunctionsUrl(), 'https://us-central1-my-project.cloudfunctions.net');
  });

  it('should return Functions URL for development', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
      // The resolved map is the only source of a dev port (#834): a real dev
      // build always bakes one, so a test that wants a number states one.
      dev: { ports: { functions: 5001 } },
    });
    assert.strictEqual(omega.getFunctionsUrl(), 'http://localhost:5001/my-project/us-central1');
  });

  it('should allow overriding environment in getFunctionsUrl', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
      dev: { ports: { functions: 5001 } },
    });
    assert.strictEqual(omega.getFunctionsUrl('development'), 'http://localhost:5001/my-project/us-central1');
  });

  it('#925: a testing run talks to the local stack only when it was handed a dev port map', async () => {
    const omega = getOmega();
    const firebase = { app: { enabled: false, config: { projectId: 'my-project' } } };

    // A testing page with no map has no local stack to reach: live, as before.
    await omega.initialize({ ...TEST_CONFIG, firebase });
    assert.strictEqual(omega._localStack(), false);
    assert.strictEqual(omega.getFunctionsUrl(), 'https://us-central1-my-project.cloudfunctions.net');

    // The desktop boot lane and the extension's emulator run bake one: local.
    await omega.initialize({ ...TEST_CONFIG, firebase, dev: { ports: { functions: 5001 } } });
    assert.strictEqual(omega._localStack(), true);
    assert.strictEqual(omega.getFunctionsUrl(), 'http://localhost:5001/my-project/us-central1');

    // Development is local with or without the question; production never is.
    await omega.initialize({ ...TEST_CONFIG, firebase, environment: 'development' });
    assert.strictEqual(omega._localStack(), true);
    await omega.initialize({ ...TEST_CONFIG, firebase, environment: 'production', dev: { ports: { functions: 5001 } } });
    assert.strictEqual(omega._localStack(), false);
    assert.strictEqual(omega.getFunctionsUrl(), 'https://us-central1-my-project.cloudfunctions.net');
  });

  it('should throw when getFunctionsUrl called without projectId', async () => {
    const omega = getOmega();
    await omega.initialize(TEST_CONFIG);
    assert.throws(() => omega.getFunctionsUrl(), /project ID/i);
  });

  it('should return API URL for development', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      dev: { ports: { https: 5002 } },
    });
    assert.strictEqual(omega.getApiUrl(), 'https://localhost:5002');
  });

  it('should derive the production API URL from brand.url, never authDomain (wave-5 F9)', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      brand: { ...TEST_CONFIG.brand, url: 'https://playground.omegajs.dev' },
      // authDomain is an auth-only concern (the brand host, with /__/auth/*
      // self-hosted at build time) — the API base never derives from it.
      firebase: { app: { enabled: false, config: { authDomain: 'example.firebaseapp.com' } } },
    });
    assert.strictEqual(omega.getApiUrl(), 'https://api.playground.omegajs.dev');
  });
});

describe('Module properties', () => {

  // Every module is a plain PROPERTY of the instance. A leftover zero-arg
  // accessor (`auth()`) would be a function here, so it fails loudly.
  const MODULES = [
    'storage', 'utilities', 'analytics', 'auth', 'bindings', 'firestore',
    'notifications', 'serviceWorker', 'sentry', 'device', 'verts', 'dom',
    'triggers', 'icons', 'motion',
  ];

  before(async () => {
    await getOmega().initialize(TEST_CONFIG);
  });

  for (const name of MODULES) {
    it(`exposes ${name} as an object property, never a method`, () => {
      const value = getOmega()[name];
      assert.strictEqual(typeof value, 'object', `omega.${name} is an object`);
      assert.notStrictEqual(value, null, `omega.${name} is built`);
    });
  }

  it('keeps request() a method: it takes arguments', () => {
    assert.strictEqual(typeof getOmega().request, 'function');
  });
});

describe('The package export', () => {

  it('exports the Omega class and no instance', async () => {
    const mod = await import('../src/index.js');

    assert.strictEqual(typeof mod.default, 'function', 'the default export is the class');
    assert.strictEqual(typeof mod.default.prototype.initialize, 'function', 'whose prototype carries initialize');
    assert.strictEqual(mod.default, mod.Omega, 'the named export is the same class');
    assert.deepStrictEqual(Object.keys(mod).sort(), ['Omega', 'default'], 'nothing else rides the entry, no instance');
  });
});

describe('omega.ready', () => {

  it('is a promise that resolves to the instance once initialize() settles', async () => {
    const { Omega } = await import('../src/index.js');
    const omega = new Omega();

    try {
      assert(omega.ready instanceof Promise, 'ready exists before initialize() runs');

      const returned = await omega.initialize(TEST_CONFIG);
      assert.strictEqual(returned, omega, 'initialize() returns the instance');
      assert.strictEqual(await omega.ready, omega, 'ready resolves to the same instance');
    } finally {
      clearInterval(omega._versionCheckInterval);
    }
  });

  it('rejects with the error initialize() rethrows', async () => {
    const { Omega } = await import('../src/index.js');
    const omega = new Omega();
    const realError = console.error;
    console.error = () => {};

    try {
      // A bridge with no event() is a broken host: initialize() raises
      await assert.rejects(() => omega.initialize({ ...TEST_CONFIG, analyticsBridge: {} }), /carries no event\(\)/);
      await assert.rejects(omega.ready, /carries no event\(\)/, 'a consumer awaiting ready sees the same error');
    } finally {
      console.error = realError;
      clearInterval(omega._versionCheckInterval);
    }
  });
});

describe('Dev ports (N7)', () => {

  afterEach(() => {
    delete global.window.__OMEGA_DEV_PORTS__;
  });

  it('should read dev.ports from the baked chrome for functions + api URLs', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
      dev: { ports: { functions: 5003, hosting: 5004 } },
    });
    assert.strictEqual(omega.getFunctionsUrl(), 'http://localhost:5003/my-project/us-central1');
    assert.strictEqual(omega.getApiUrl(), 'http://127.0.0.1:5004');
  });

  it('should let the BAKED CHROME win over the runtime channel, which only fills what the chrome omits (#300)', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
      dev: { ports: { functions: 5003, hosting: 5004 } },
    });
    // The chrome is written per render by the dev server that served this page
    // — a driver's injected map is a fallback for pages that carry none, and
    // must never be able to mask a wrong (or right) baked map
    global.window.__OMEGA_DEV_PORTS__ = { functions: 5103, hosting: 5104, auth: 9199 };
    assert.strictEqual(omega.getFunctionsUrl(), 'http://localhost:5003/my-project/us-central1');
    assert.strictEqual(omega.getApiUrl(), 'http://127.0.0.1:5004');
    assert.strictEqual(omega._devPort('auth'), 9199, 'a key the chrome omits still comes from the runtime channel');
  });

  it('should throw, naming the build step, for a dev port nobody resolved (#834)', async () => {
    const omega = getOmega();

    // Only this server's own port resolved: every emulator number used to be
    // an assumed classic with a warning beside it. The classics are gone: a
    // number nobody resolved is a guess about somebody else's stack, so the
    // read fails at the call that needed it and names where the map comes from.
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      dev: { ports: { website: 4001 } },
    });

    for (const name of ['auth', 'firestore', 'functions', 'hosting']) {
      assert.throws(() => omega._devPort(name), (error) => {
        assert.match(error.message, new RegExp(`dev port for \`${name}\``), 'names the port it wanted');
        assert.match(error.message, /OMEGA_BUILD_JSON\.config\.dev/, 'names the channel');
        assert.match(error.message, /bundle tasks at build time/, 'names the build step that writes it');
        return true;
      }, `${name} throws rather than assuming a classic`);
    }

    // A resolved map answers every one of them, with no warning and no guess.
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      dev: { ports: { auth: 9100, firestore: 8081, functions: 5002, hosting: 5003 } },
    });
    assert.strictEqual(omega._devPort('auth'), 9100);
    assert.strictEqual(omega._devPort('firestore'), 8081);
    assert.strictEqual(omega._devPort('functions'), 5002);
    assert.strictEqual(omega._devPort('hosting'), 5003);
  });

  it('should answer the dev website origin from the resolved map, and say so when it has to assume (#262)', async () => {
    const omega = getOmega();
    const realWarn = console.warn;
    let warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    const originLines = () => warnings.filter((line) => line.includes('No resolved dev website origin'));

    try {
      // The stack published its origin — protocol and port both, and a bumped
      // https run is exactly the case a port-only map could never express
      await omega.initialize({
        ...TEST_CONFIG,
        environment: 'development',
        dev: { ports: { website: 4001 }, origin: 'https://localhost:4001' },
      });
      assert.strictEqual(omega.getDevWebsiteOrigin(), 'https://localhost:4001');
      assert.strictEqual(originLines().length, 0, 'a resolved fact says nothing');

      // Nothing published one: the classic https://localhost:4000 assumption is
      // gone (#834). A wrong dev origin fails as a silent connection refusal,
      // so the miss is loud at the read instead.
      warnings = [];
      await omega.initialize({ ...TEST_CONFIG, environment: 'development' });
      assert.throws(() => omega.getDevWebsiteOrigin(), (error) => {
        assert.match(error.message, /dev website origin/);
        assert.match(error.message, /OMEGA_BUILD_JSON\.config\.dev/, 'names the channel');
        assert.match(error.message, /`omega dev` \(into the page chrome, per response\)/, 'names the build step that writes it');
        return true;
      });
      assert.strictEqual(originLines().length, 0, 'nothing is assumed, so nothing is warned about');
    } finally {
      console.warn = realWarn;
    }
  });

  it('should prefer an https (mkcert proxy) entry over plain-http hosting', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      dev: { ports: { https: 5443, hosting: 5004 } },
    });
    assert.strictEqual(omega.getApiUrl(), 'https://localhost:5443');
  });

  it('should point the auth emulator at the SITE origin when the dev server proxies it (#156)', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      dev: { ports: { auth: 9099 }, authEmulatorProxy: true },
    });
    // Same-origin is the whole point: the OAuth handler's sessionStorage and
    // the SDK's helper iframe land in the page's own storage partition
    assert.strictEqual(omega._authEmulatorUrl(), 'http://localhost:3000');
  });

  it('should point the auth emulator at its own port when no proxy is declared', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      dev: { ports: { auth: 9199 } },
    });
    assert.strictEqual(omega._authEmulatorUrl(), 'http://localhost:9199');
  });

  it('should throw, naming the build step, when no dev map was baked at all (#834)', async () => {
    const omega = getOmega();
    await omega.initialize({
      ...TEST_CONFIG,
      environment: 'development',
      firebase: { app: { enabled: false, config: { projectId: 'my-project' } } },
    });

    // The two URL getters that used to answer with a classic number.
    assert.throws(() => omega.getApiUrl(), /dev `https` or `hosting` port/);
    assert.throws(() => omega.getApiUrl(), /OMEGA_BUILD_JSON\.config\.dev/);
    assert.throws(() => omega.getFunctionsUrl(), /dev port for `functions`/);

    // Production is untouched: it has no local stack to resolve and never did.
    assert.match(omega.getApiUrl('production'), /^https:\/\/api\./);
  });

  it('should version-check /build.json only — the retired npm-build shape carries no timestamp (#148)', async () => {
    const omega = getOmega();
    await omega.initialize({
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
      await omega._checkVersion();
      assert.strictEqual(urls.length, 1, 'exactly one path is probed');
      assert.ok(urls[0].startsWith('/build.json?cb='), '/build.json is the one path');
      assert.strictEqual(reloads, 0, 'the retired key never reloads the page');

      // The current shape: a newer timestamp reloads
      global.fetch = async () => ({ ok: true, json: async () => ({ timestamp: new Date(Date.now() + 86400000).toISOString() }) });
      await omega._checkVersion();
      assert.strictEqual(reloads, 1, 'a newer build.json timestamp reloads');
    } finally {
      global.fetch = originalFetch;
      global.window.location.reload = originalReload;
    }
  });
});
