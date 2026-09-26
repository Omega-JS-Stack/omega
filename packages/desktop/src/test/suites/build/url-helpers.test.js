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
// The last case pins the auth emulator port lib/auth.js connects a testing
// run to: the same three-step chain, off the same baked map.

const path = require('path');

const helpers = require(path.join(__dirname, '..', '..', '..', 'utils', 'url-helpers.js'));
const auth = require(path.join(__dirname, '..', '..', '..', 'lib', 'auth.js'));
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

// The shape the helpers see at runtime: an omega instance carrying the resolved config
// (OMEGA_BUILD_JSON.config, `dev` block and all) plus mode-helpers' getEnvironment().
function fakeOmega(environment, ports, origin) {
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

// Run `fn` with auth pointed at a stand-in instance, then put the real one back.
function withAuthOmega(omega, fn) {
  const original = auth._omega;
  auth._omega = omega;
  try { return fn(); } finally { auth._omega = original; }
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
  description: 'utils/url-helpers: every local helper resolves env, then the baked dev.ports, then throws',
  tests: [
    {
      // Plain functions the `Omega` classes call with themselves as `context`:
      // no mixin onto a constructor any more
      name: 'exports { getApiUrl, localPort, requiredPort } and no attachTo',
      run: (ctx) => {
        ctx.expect(helpers.attachTo).toBeUndefined();
        ctx.expect(typeof helpers.getApiUrl).toBe('function');
        ctx.expect(typeof helpers.localPort).toBe('function');
        ctx.expect(typeof helpers.requiredPort).toBe('function');
      },
    },
    {
      name: 'a BUMPED baked dev.ports.hosting is the api base in testing',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const omega = fakeOmega('testing', { hosting: 5012, auth: 9109 });
          ctx.expect(helpers.getApiUrl(omega)).toBe('http://localhost:5012');
        });
      },
    },
    {
      name: 'a BUMPED baked dev.ports.hosting is the api base in development too',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const omega = fakeOmega('development', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl(omega)).toBe('http://localhost:5012');
        });
      },
    },
    {
      name: 'OMEGA_HOSTING_PORT wins over the baked value',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_HOSTING_PORT: '5022' }, () => {
          const omega = fakeOmega('testing', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl(omega)).toBe('http://localhost:5022');
        });
      },
    },
    {
      // The classic 5002 used to answer here (#834). It is gone: a dev build
      // always bakes the resolved map, so neither channel answering means the
      // artifact is broken, and a wrong API base is a silent connection refusal
      // or a hit on a neighbouring project's stack.
      name: 'neither channel → a throw naming the port and the bundle task',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          for (const environment of ['testing', 'development']) {
            ctx.expect(() => helpers.getApiUrl(fakeOmega(environment)))
              .toThrow(/dev port for `hosting`/);
            ctx.expect(() => helpers.getApiUrl(fakeOmega(environment)))
              .toThrow(/bundle task/);
          }
        });
      },
    },
    {
      name: 'OMEGA_HTTPS_PORT means the mkcert proxy is up: https, not hosting',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_HTTPS_PORT: '5003' }, () => {
          const omega = fakeOmega('testing', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl(omega)).toBe('https://localhost:5003');
        });
      },
    },
    {
      name: 'a baked dev.ports.https does the same with no env published',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const omega = fakeOmega('testing', { https: 5003, hosting: 5443 });
          ctx.expect(helpers.getApiUrl(omega)).toBe('https://localhost:5003');
        });
      },
    },
    {
      name: 'production ignores every local channel, giving api.<brand host>',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_HOSTING_PORT: '5022' }, () => {
          const omega = fakeOmega('production', { hosting: 5012 });
          ctx.expect(helpers.getApiUrl(omega)).toBe('https://api.playground.omegajs.dev');
        });
      },
    },
    {
      name: 'getFunctionsUrl: a BUMPED baked dev.ports.functions is the functions base',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const omega = fakeOmega('development', { functions: 5011 });
          ctx.expect(helpers.getFunctionsUrl(omega))
            .toBe('http://localhost:5011/demo-app/us-central1');
        });
      },
    },
    {
      name: 'getFunctionsUrl: OMEGA_FUNCTIONS_PORT wins over the baked value',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_FUNCTIONS_PORT: '5021' }, () => {
          const omega = fakeOmega('testing', { functions: 5011 });
          ctx.expect(helpers.getFunctionsUrl(omega))
            .toBe('http://localhost:5021/demo-app/us-central1');
        });
      },
    },
    {
      name: 'getFunctionsUrl: neither channel → a throw naming the port (#834)',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          ctx.expect(() => helpers.getFunctionsUrl(fakeOmega('development')))
            .toThrow(/dev port for `functions`/);
        });
      },
    },
    {
      name: 'getFunctionsUrl: production ignores every local channel',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_FUNCTIONS_PORT: '5021' }, () => {
          const omega = fakeOmega('production', { functions: 5011 });
          ctx.expect(helpers.getFunctionsUrl(omega))
            .toBe('https://us-central1-demo-app.cloudfunctions.net');
        });
      },
    },
    {
      name: 'getWebsiteUrl: a BUMPED baked dev.ports.website is the website base',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const omega = fakeOmega('development', { website: 4001 });
          ctx.expect(helpers.getWebsiteUrl(omega)).toBe('https://localhost:4001');
        });
      },
    },
    {
      name: 'getWebsiteUrl: OMEGA_WEBSITE_PORT wins over the baked value',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_WEBSITE_PORT: '4002' }, () => {
          const omega = fakeOmega('testing', { website: 4001 });
          ctx.expect(helpers.getWebsiteUrl(omega)).toBe('https://localhost:4002');
        });
      },
    },
    {
      name: 'getWebsiteUrl: neither channel → a throw naming the port (#834)',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          ctx.expect(() => helpers.getWebsiteUrl(fakeOmega('development')))
            .toThrow(/dev port for `website`/);
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
          const omega = fakeOmega('development', { website: 4001 }, 'https://localhost:4123');
          ctx.expect(helpers.getWebsiteUrl(omega)).toBe('https://localhost:4123');
        });
      },
    },
    {
      name: 'getWebsiteUrl: OMEGA_WEBSITE_PORT with no baked origin composes over https',
      run: (ctx) => {
        withEnv({ ...NO_ENV, OMEGA_WEBSITE_PORT: '4321' }, () => {
          ctx.expect(helpers.getWebsiteUrl(fakeOmega('development'))).toBe('https://localhost:4321');
        });
      },
    },
    {
      // There is no lockstep copy to keep honest any more (#834): the classic
      // numbers live ONLY in @omega.js/config, the bundle task bakes them into
      // the artifact as the floor of the resolved map, and this module reads
      // that map. A copy here would be the exact defect the issue closed.
      name: 'no classic constants live in this module (#834)',
      run: (ctx) => {
        ctx.expect(helpers.CLASSIC_DEV_ORIGIN).toBe(undefined);
        const source = require('fs').readFileSync(require.resolve('../../../utils/url-helpers.js'), 'utf8');
        const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
        for (const classic of ['4000', '5001', '5002', '9099']) {
          ctx.expect(code.includes(classic)).toBe(false);
        }
      },
    },
    {
      // getAuthUrl builds both hops off getWebsiteUrl, so the scheme fix reaches
      // the sign-in round trip by construction.
      name: 'getAuthUrl: dev builds /signin and /token on the https dev origin',
      run: (ctx) => {
        withEnv(NO_ENV, () => {
          const omega = fakeOmega('development', { website: 4000 });
          const url = new URL(helpers.getAuthUrl(omega));
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
          const omega = fakeOmega('production', { website: 4001 });
          ctx.expect(helpers.getWebsiteUrl(omega)).toBe('https://playground.omegajs.dev');
        });
      },
    },
    {
      // lib/auth.js connects a TESTING run's auth to the emulator. Same chain:
      // env, then the baked map, then classic 9099.
      name: 'the auth emulator port rides the same chain (lib/auth.js)',
      run: (ctx) => {
        withEnv({ OMEGA_AUTH_PORT: null }, () => {
          withAuthOmega(fakeOmega('testing', { auth: 9109 }), () => {
            ctx.expect(auth._authEmulatorPort()).toBe(9109);
          });
          // The classic 9099 used to answer here (#834): nothing identity-checks
          // what holds that port, so a neighbouring project's emulator read as
          // an auth mystery instead of a port problem.
          withAuthOmega(fakeOmega('testing'), () => {
            ctx.expect(() => auth._authEmulatorPort()).toThrow(/dev port for `auth`/);
            ctx.expect(() => auth._authEmulatorPort()).toThrow(/bundle task/);
          });
        });
        withEnv({ OMEGA_AUTH_PORT: '9119' }, () => {
          withAuthOmega(fakeOmega('testing', { auth: 9109 }), () => {
            ctx.expect(auth._authEmulatorPort()).toBe('9119');
          });
        });
      },
    },
  ],
});
