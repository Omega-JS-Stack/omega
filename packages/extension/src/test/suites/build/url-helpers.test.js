// Build-layer test for utils/url-helpers.js — verifies getApiUrl() resolves the
// LOCAL hosting port from every channel a context can have, in precedence
// order: the OMEGA_*_PORT env vars (build-time Node + the test harness), then
// the `dev.ports` block the build bakes into OMEGA_BUILD_JSON (the ONLY channel a
// browser context has — [#744](https://github.com/Omega-JS-Stack/omega/issues/744)),
// then the classic defaults.

const path = require('path');

const helpers = require(path.join(__dirname, '..', '..', '..', 'utils', 'url-helpers.js'));
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

// The shape getApiUrl() sees at runtime: a context Manager carrying the parsed
// baked config plus mode-helpers' getEnvironment().
function fakeManager(environment, ports) {
  return {
    getEnvironment: () => environment,
    config: {
      brand: { url: 'https://playground.omegajs.dev' },
      ...(ports ? { dev: { ports } } : {}),
    },
  };
}

// Neither env channel published — the state every browser context is in.
const NO_ENV = { OMEGA_HOSTING_PORT: null, OMEGA_HTTPS_PORT: null };

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'utils/url-helpers — getApiUrl resolves env → baked dev.ports → classic',
  tests: [
    {
      name: 'exports { attachTo, getApiUrl }',
      run: (ctx) => {
        ctx.expect(typeof helpers.attachTo).toBe('function');
        ctx.expect(typeof helpers.getApiUrl).toBe('function');
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
      name: 'OMEGA_HTTPS_PORT means the mkcert proxy is up — https, not hosting',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_HTTPS_PORT: '5003' }, () => {
          const manager = fakeManager('testing', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl.call(manager)).toBe('https://localhost:5003');
        });
      },
    },
    {
      name: 'a baked dev.ports.https does the same for a browser context',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const manager = fakeManager('testing', { https: 5003, hosting: 5443 });
          ctx.expect(helpers.getApiUrl.call(manager)).toBe('https://localhost:5003');
        });
      },
    },
    {
      name: 'production ignores every local channel — api.<brand host>',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_HOSTING_PORT: '5022' }, () => {
          const manager = fakeManager('production', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl.call(manager)).toBe('https://api.playground.omegajs.dev');
        });
      },
    },
  ],
});
