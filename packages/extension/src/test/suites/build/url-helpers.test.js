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
  description: 'utils/url-helpers: getApiUrl resolves env, then the baked dev.ports, then throws',
  tests: [
    {
      name: 'exports { attachTo, getApiUrl, localPort, requiredPort }',
      run: (ctx) => {
        ctx.expect(typeof helpers.attachTo).toBe('function');
        ctx.expect(typeof helpers.getApiUrl).toBe('function');
        ctx.expect(typeof helpers.localPort).toBe('function');
        ctx.expect(typeof helpers.requiredPort).toBe('function');
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
      // The classic 5002 used to answer here
      // ([#834](https://github.com/Omega-JS-Stack/omega/issues/834)). It is gone:
      // a dev build always bakes the resolved map, so neither channel answering
      // means the artifact is broken, and a wrong API base is a silent
      // connection refusal or a hit on a neighbouring project's stack.
      name: 'neither channel → a throw naming the port and the bundle task',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          for (const environment of ['testing', 'development']) {
            ctx.expect(() => helpers.getApiUrl.call(fakeManager(environment))).toThrow(/dev port for `hosting`/);
            ctx.expect(() => helpers.getApiUrl.call(fakeManager(environment))).toThrow(/bundle task/);
          }
        });
      },
    },
    {
      // No copy of the classic numbers lives in this module any more (#834):
      // they are defined once, in @omega.js/config, and reach a browser context
      // only through the map the bundle task bakes.
      name: 'no classic constants live in this module (#834)',
      run: (ctx) => {
        const source = require('fs').readFileSync(require.resolve('../../../utils/url-helpers.js'), 'utf8');
        const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
        for (const classic of ['4000', '5001', '5002', '9099']) {
          ctx.expect(code.includes(classic)).toBe(false);
        }
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
