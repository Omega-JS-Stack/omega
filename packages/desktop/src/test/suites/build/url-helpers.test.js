// Build-layer test for utils/url-helpers.js. Verifies every LOCAL helper
// (getApiUrl, getFunctionsUrl, getWebsiteUrl) resolves its port from every
// channel the MAIN process has, in precedence order: the OMEGA_*_PORT env vars
// (the CLI that booted the stack publishes them, N7), then the `dev.ports` map
// the bundle baked into OMEGA_BUILD_JSON (a PACKAGED main process has no parent
// env, [#745](https://github.com/Omega-JS-Stack/omega/issues/745)), then the
// classic defaults. Mirrors @omega.js/extension's suite of the same name.
//
// getWebsiteUrl is the one helper whose local answer is a whole ORIGIN rather
// than a port on an assumed scheme: it reads the baked `dev.origin` the website
// published, then composes OMEGA_WEBSITE_PORT / the baked port over https, then
// the classic dev origin ([#747](https://github.com/Omega-JS-Stack/omega/issues/747)).
//
// The last case pins the auth emulator port client-bridge connects a testing
// run to: the same three-step chain, off the same baked map.

const path = require('path');

const helpers = require(path.join(__dirname, '..', '..', '..', 'utils', 'url-helpers.js'));
const clientBridge = require(path.join(__dirname, '..', '..', '..', 'lib', 'client-bridge.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

function withEnv(overrides, fn) {
  const originals = {};
  for (const [k, v] of Object.entries(overrides)) {
    originals[k] = process.env[k];
    if (v === null) delete process.env[k];
    else            process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else                 process.env[k] = v;
    }
  }
}

// The shape the helpers see at runtime: a Manager carrying the resolved config
// (OMEGA_BUILD_JSON.config, `dev` block and all) plus mode-helpers' getEnvironment().
function fakeManager(environment, ports, origin) {
  return {
    getEnvironment: () => environment,
    isTesting: () => environment === 'testing',
    config: {
      brand: { id: 'demo', url: 'https://playground.omegajs.dev' },
      cloud: { config: { projectId: 'demo-app' } },
      ...(ports || origin
        ? { dev: { ...(ports ? { ports } : {}), ...(origin ? { origin } : {}) } }
        : {}),
    },
  };
}

// Run `fn` with the bridge pointed at a stand-in Manager, then put the real one back.
function withBridgeManager(manager, fn) {
  const original = clientBridge._manager;
  clientBridge._manager = manager;
  try { return fn(); } finally { clientBridge._manager = original; }
}

// No env channel published: the state a packaged main process is in.
const NO_ENV = {
  OMEGA_HOSTING_PORT: null,
  OMEGA_HTTPS_PORT: null,
  OMEGA_FUNCTIONS_PORT: null,
  OMEGA_WEBSITE_PORT: null,
};

module.exports = defineCases({
  type: 'group', // independent tests; run all even on failure
  layer: 'build',
  description: 'utils/url-helpers: every local helper resolves env → baked dev.ports → classic',
  tests: [
    {
      name: 'exports { attachTo, getApiUrl, localPort }',
      run: (ctx) => {
        ctx.expect(typeof helpers.attachTo).toBe('function');
        ctx.expect(typeof helpers.getApiUrl).toBe('function');
        ctx.expect(typeof helpers.localPort).toBe('function');
      },
    },
    {
      name: 'a BUMPED baked dev.ports.hosting is the api base in testing',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const manager = fakeManager('testing', { hosting: 5012, auth: 9109 });
          ctx.expect(helpers.getApiUrl.call(manager)).toBe('http://localhost:5012');
        });
      },
    },
    {
      name: 'a BUMPED baked dev.ports.hosting is the api base in development too',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const manager = fakeManager('development', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl.call(manager)).toBe('http://localhost:5012');
        });
      },
    },
    {
      name: 'OMEGA_HOSTING_PORT wins over the baked value',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_HOSTING_PORT: '5022' }, () => {
          const manager = fakeManager('testing', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl.call(manager)).toBe('http://localhost:5022');
        });
      },
    },
    {
      name: 'neither channel → the classic hosting port 5002',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          ctx.expect(helpers.getApiUrl.call(fakeManager('testing'))).toBe('http://localhost:5002');
          ctx.expect(helpers.getApiUrl.call(fakeManager('development'))).toBe('http://localhost:5002');
        });
      },
    },
    {
      name: 'OMEGA_HTTPS_PORT means the mkcert proxy is up: https, not hosting',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_HTTPS_PORT: '5003' }, () => {
          const manager = fakeManager('testing', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl.call(manager)).toBe('https://localhost:5003');
        });
      },
    },
    {
      name: 'a baked dev.ports.https does the same with no env published',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const manager = fakeManager('testing', { https: 5003, hosting: 5443 });
          ctx.expect(helpers.getApiUrl.call(manager)).toBe('https://localhost:5003');
        });
      },
    },
    {
      name: 'production ignores every local channel, giving api.<brand host>',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_HOSTING_PORT: '5022' }, () => {
          const manager = fakeManager('production', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl.call(manager)).toBe('https://api.playground.omegajs.dev');
        });
      },
    },
    {
      name: 'getFunctionsUrl: a BUMPED baked dev.ports.functions is the functions base',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const manager = fakeManager('development', { functions: 5011 });
          ctx.expect(helpers.getFunctionsUrl.call(manager))
            .toBe('http://localhost:5011/demo-app/us-central1');
        });
      },
    },
    {
      name: 'getFunctionsUrl: OMEGA_FUNCTIONS_PORT wins over the baked value',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_FUNCTIONS_PORT: '5021' }, () => {
          const manager = fakeManager('testing', { functions: 5011 });
          ctx.expect(helpers.getFunctionsUrl.call(manager))
            .toBe('http://localhost:5021/demo-app/us-central1');
        });
      },
    },
    {
      name: 'getFunctionsUrl: neither channel → the classic functions port 5001',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          ctx.expect(helpers.getFunctionsUrl.call(fakeManager('development')))
            .toBe('http://localhost:5001/demo-app/us-central1');
        });
      },
    },
    {
      name: 'getFunctionsUrl: production ignores every local channel',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_FUNCTIONS_PORT: '5021' }, () => {
          const manager = fakeManager('production', { functions: 5011 });
          ctx.expect(helpers.getFunctionsUrl.call(manager))
            .toBe('https://us-central1-demo-app.cloudfunctions.net');
        });
      },
    },
    {
      name: 'getWebsiteUrl: a BUMPED baked dev.ports.website is the website base',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const manager = fakeManager('development', { website: 4001 });
          ctx.expect(helpers.getWebsiteUrl.call(manager)).toBe('https://localhost:4001');
        });
      },
    },
    {
      name: 'getWebsiteUrl: OMEGA_WEBSITE_PORT wins over the baked value',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_WEBSITE_PORT: '4002' }, () => {
          const manager = fakeManager('testing', { website: 4001 });
          ctx.expect(helpers.getWebsiteUrl.call(manager)).toBe('https://localhost:4002');
        });
      },
    },
    {
      name: 'getWebsiteUrl: neither channel → the classic dev origin https://localhost:4000',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          ctx.expect(helpers.getWebsiteUrl.call(fakeManager('development'))).toBe('https://localhost:4000');
        });
      },
    },
    {
      // The whole fact beats a port: `dev.origin` is what the live website
      // published (scheme, host AND port), so a port on an assumed scheme never
      // overrides it (#747).
      name: 'getWebsiteUrl: a baked dev.origin wins over OMEGA_WEBSITE_PORT',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_WEBSITE_PORT: '4002' }, () => {
          const manager = fakeManager('development', { website: 4001 }, 'https://localhost:4123');
          ctx.expect(helpers.getWebsiteUrl.call(manager)).toBe('https://localhost:4123');
        });
      },
    },
    {
      name: 'getWebsiteUrl: OMEGA_WEBSITE_PORT with no baked origin composes over https',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_WEBSITE_PORT: '4321' }, () => {
          ctx.expect(helpers.getWebsiteUrl.call(fakeManager('development'))).toBe('https://localhost:4321');
        });
      },
    },
    {
      // The lockstep the renderer bundle forces: url-helpers rides the browser
      // bundle, so it cannot require @omega.js/config (fs/net/json5) and mirrors
      // the constant instead. This Node-side case is what keeps the copy honest.
      name: 'CLASSIC_DEV_ORIGIN is in lockstep with @omega.js/config',
      run: (ctx) => {
        ctx.expect(helpers.CLASSIC_DEV_ORIGIN).toBe(require('@omega.js/config').CLASSIC_DEV_ORIGIN);
      },
    },
    {
      // getAuthUrl builds both hops off getWebsiteUrl, so the scheme fix reaches
      // the sign-in round trip by construction.
      name: 'getAuthUrl: dev builds /signin and /token on the https dev origin',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          // getAuthUrl calls `this.getWebsiteUrl()`, which attachTo() supplies on a
          // real Manager — hand the stand-in the same helper.
          const manager = fakeManager('development');
          manager.getWebsiteUrl = helpers.getWebsiteUrl;
          const url = new URL(helpers.getAuthUrl.call(manager));
          ctx.expect(url.origin).toBe('https://localhost:4000');
          ctx.expect(url.pathname).toBe('/signin');
          const tokenUrl = new URL(url.searchParams.get('authReturnUrl'));
          ctx.expect(tokenUrl.origin).toBe('https://localhost:4000');
          ctx.expect(tokenUrl.pathname).toBe('/token');
          ctx.expect(tokenUrl.searchParams.get('authReturnUrl')).toBe('demo://auth/token');
        });
      },
    },
    {
      name: 'getWebsiteUrl: production ignores every local channel',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_WEBSITE_PORT: '4002' }, () => {
          const manager = fakeManager('production', { website: 4001 });
          ctx.expect(helpers.getWebsiteUrl.call(manager)).toBe('https://playground.omegajs.dev');
        });
      },
    },
    {
      // client-bridge connects a TESTING run's auth to the emulator. Same chain:
      // env, then the baked map, then classic 9099.
      name: 'the auth emulator port rides the same chain (client-bridge)',
      run: (ctx) => {
        withEnv({ OMEGA_AUTH_PORT: null }, () => {
          withBridgeManager(fakeManager('testing', { auth: 9109 }), () => {
            ctx.expect(clientBridge._authEmulatorPort()).toBe(9109);
          });
          withBridgeManager(fakeManager('testing'), () => {
            ctx.expect(clientBridge._authEmulatorPort()).toBe(9099);
          });
        });
        withEnv({ OMEGA_AUTH_PORT: '9119' }, () => {
          withBridgeManager(fakeManager('testing', { auth: 9109 }), () => {
            ctx.expect(clientBridge._authEmulatorPort()).toBe('9119');
          });
        });
      },
    },
  ],
});
