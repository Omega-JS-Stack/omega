/**
 * Test: environment detection + URL helpers
 * Covers the Omega instance's getEnvironment() SSOT, the derived is*() checks, the URL
 * builders (getApiUrl / getFunctionsUrl / getWebsiteUrl + parent variants), and the
 * ctx→omega forwarding.
 *
 * Run: npx omega test backend:helpers/environment
 *
 * Contract (see docs/environment-detection.md):
 *   - getEnvironment() is @omega.js/config's, the ONE environment module every
 *     OMEGA target answers from ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)).
 *     It reads ONE input, `OMEGA_ENVIRONMENT`, which this backend's boot sets
 *     once from the .env cascade's own ambient answer (the test runner's word,
 *     then FUNCTIONS_EMULATOR or an explicit ENVIRONMENT, else production for a
 *     deployed function). Returns exactly ONE of
 *     'development' | 'testing' | 'production', and a missing input throws by name.
 *   - isDevelopment()/isProduction()/isTesting() DERIVE from getEnvironment() — they
 *     never read raw signals, so they can NEVER disagree with it. Exactly one is true.
 *   - getApiUrl/getFunctionsUrl/getWebsiteUrl resolve LOCAL in dev OR testing, prod
 *     otherwise. The parent helpers ALWAYS return the live URL (no localhost).
 *   - The ctx forwards each method to its omega (identical results).
 */

// The local port a getter must answer with: the RESOLVED one the CLI injected
// into this runner child (OMEGA_<NAME>_PORT, the #291 map), classic default
// when unset. Pinning the classic numbers here failed every bumped run — a
// second stack on 5001/5002 moves the whole map and the getters move with it
// ([#291](https://github.com/Omega-JS-Stack/omega/issues/291)). A getter that
// hardcodes its port still fails these: on a bumped run it answers the classic
// number while this reads the injected one.

// The classic default is READ, never re-typed: `CLASSIC_PORTS` is the one home
// of those numbers and the getters under test answer from the same map
// ([#834](https://github.com/Omega-JS-Stack/omega/issues/834)). The env read
// stays this file's own, so a getter that stopped honouring the injected map
// still fails here.
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const { CLASSIC_PORTS, envEnvironment } = require('../../dist/vendor/config/index.js');
function localPort(name) {
  return process.env[`OMEGA_${name.toUpperCase()}_PORT`] || CLASSIC_PORTS[name];
}

// Run a thunk with the environment input set, restoring it afterward.
// `OMEGA_ENVIRONMENT` is the ONLY input getEnvironment() reads (#817), so
// naming it is the whole raw-signal surface; the other three are the AMBIENT
// signals the boot resolves it FROM, cleared here so nothing ambiguous is left.
function withEnv(overrides, fn) {
  const KEYS = ['OMEGA_ENVIRONMENT', 'OMEGA_TEST_MODE', 'ENVIRONMENT', 'FUNCTIONS_EMULATOR', 'TERM_PROGRAM'];
  const saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  try {
    for (const k of KEYS) delete process.env[k];
    for (const k of Object.keys(overrides)) process.env[k] = overrides[k];
    return fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

module.exports = defineCases({
  description: 'Environment detection + URL helpers',
  type: 'group',

  tests: [
    // ─── getEnvironment() resolution + precedence ───

    {
      name: 'getEnvironment: the one input is the answer, whatever the ambient signals say',
      async run({ omega, assert }) {
        // The boot resolved the input once; nothing re-sniffs ENVIRONMENT or
        // FUNCTIONS_EMULATOR at read time any more (#817).
        withEnv({ OMEGA_ENVIRONMENT: 'testing', ENVIRONMENT: 'production' }, () => {
          assert.equal(omega.getEnvironment(), 'testing');
        });
      },
    },
    {
      name: 'getEnvironment: production when the lane named production',
      async run({ omega, assert }) {
        withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => {
          assert.equal(omega.getEnvironment(), 'production');
        });
      },
    },
    {
      name: 'getEnvironment: development when the lane named development',
      async run({ omega, assert }) {
        withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
          assert.equal(omega.getEnvironment(), 'development');
        });
      },
    },
    {
      name: 'the boot resolves the input from the ambient answer: FUNCTIONS_EMULATOR is development',
      async run({ omega, assert }) {
        // envEnvironment() is the PRODUCER of the input, and the boot runs it
        // once. Its ambient rules are unchanged: an emulator run is development.
        withEnv({ FUNCTIONS_EMULATOR: 'true' }, () => {
          assert.equal(envEnvironment(), 'development');
        });
        withEnv({ ENVIRONMENT: 'production' }, () => {
          assert.equal(envEnvironment(), 'production');
        });
        withEnv({ OMEGA_TEST_MODE: 'true', ENVIRONMENT: 'production' }, () => {
          assert.equal(envEnvironment(), 'testing', 'a test run is not production, whatever else says');
        });
        withEnv({}, () => {
          assert.equal(envEnvironment(), 'production', 'no signal is production, a deployed function carries none');
        });
        // And the input, once named, wins over every ambient signal.
        withEnv({ OMEGA_ENVIRONMENT: 'development', ENVIRONMENT: 'production' }, () => {
          assert.equal(envEnvironment(), 'development');
        });
      },
    },
    {
      name: 'getEnvironment: NO default, a missing input is a loud error naming the variable',
      async run({ omega, assert }) {
        // The four framework copies this replaced each had their own default,
        // and they disagreed (#817). There is none here: a process whose lane
        // never named an environment says so instead of guessing one.
        withEnv({}, () => {
          let thrown = null;

          try {
            omega.getEnvironment();
          } catch (error) {
            thrown = error;
          }

          assert.ok(thrown, 'a process whose lane named no environment must refuse, never answer');
          assert.match(thrown.message, /OMEGA_ENVIRONMENT/, `the refusal names the variable, got: ${thrown && thrown.message}`);
        });
      },
    },

    // ─── The KEY invariant: is*() derive from getEnvironment() and can NEVER disagree ───

    {
      name: 'invariant: is*() exactly matches getEnvironment() across every scenario',
      async run({ omega, assert }) {
        const scenarios = [
          { env: { OMEGA_ENVIRONMENT: 'testing', ENVIRONMENT: 'production' }, expect: 'testing' },
          { env: { OMEGA_ENVIRONMENT: 'production' },                     expect: 'production' },
          { env: { OMEGA_ENVIRONMENT: 'development' },                    expect: 'development' },
        ];
        for (const s of scenarios) {
          withEnv(s.env, () => {
            const e = omega.getEnvironment();
            assert.equal(e, s.expect, `getEnvironment for ${JSON.stringify(s.env)}`);
            // Each is*() must equal (getEnvironment() === its value) — no independent reads.
            assert.equal(omega.isDevelopment(), e === 'development', `isDevelopment for ${e}`);
            assert.equal(omega.isTesting(),     e === 'testing',     `isTesting for ${e}`);
            assert.equal(omega.isProduction(),  e === 'production',  `isProduction for ${e}`);
          });
        }
      },
    },
    {
      name: 'invariant: exactly one of is*() is true in every scenario (mutually exclusive)',
      async run({ omega, assert }) {
        const envs = [
          { OMEGA_ENVIRONMENT: 'testing' },
          { OMEGA_ENVIRONMENT: 'production' },
          { OMEGA_ENVIRONMENT: 'development' },
        ];
        for (const env of envs) {
          withEnv(env, () => {
            const trueCount = [omega.isDevelopment(), omega.isTesting(), omega.isProduction()]
              .filter(Boolean).length;
            assert.equal(trueCount, 1, `exactly one true for ${JSON.stringify(env)}`);
          });
        }
      },
    },
    {
      name: 'isProduction is a real positive check (NOT just !isDevelopment) — false in testing',
      async run({ omega, assert }) {
        withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => {
          assert.equal(omega.isDevelopment(), false, 'isDevelopment false in testing');
          assert.equal(omega.isProduction(),  false, 'isProduction false in testing');
          assert.equal(omega.isTesting(),     true,  'isTesting true in testing');
        });
      },
    },

    // ─── ctx forwards to the Omega instance (identical results) ───

    {
      name: 'ctx forwards getEnvironment()/is*() to the omega (identical)',
      async run({ omega, ctx, assert }) {
        const cases = [
          { OMEGA_ENVIRONMENT: 'testing' },
          { OMEGA_ENVIRONMENT: 'production' },
          { OMEGA_ENVIRONMENT: 'development' },
        ];
        for (const env of cases) {
          withEnv(env, () => {
            assert.equal(ctx.getEnvironment(), omega.getEnvironment(), 'getEnvironment forward');
            assert.equal(ctx.isDevelopment(), omega.isDevelopment(), 'isDevelopment forward');
            assert.equal(ctx.isTesting(),     omega.isTesting(),     'isTesting forward');
            assert.equal(ctx.isProduction(),  omega.isProduction(),  'isProduction forward');
          });
        }
      },
    },

    // ─── URL helpers: local in dev/testing, production otherwise ───

    {
      name: 'getApiUrl: localhost in development AND testing, prod otherwise',
      async run({ omega, assert }) {
        const hosting = `http://localhost:${localPort('hosting')}`;
        withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
          assert.equal(omega.getApiUrl(), hosting, 'dev → localhost');
        });
        withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => {
          assert.equal(omega.getApiUrl(), hosting, 'testing → localhost');
        });
        withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => {
          assert.match(omega.getApiUrl(), /^https:\/\/api\./, 'prod → api.<domain>');
        });
      },
    },
    {
      name: 'getApiUrl: explicit env arg overrides current environment',
      async run({ omega, assert }) {
        // Under the test harness we're in 'testing', but an explicit arg forces the mapping.
        assert.equal(omega.getApiUrl('development'), `http://localhost:${localPort('hosting')}`, "arg 'development' → localhost");
        assert.match(omega.getApiUrl('production'), /^https:\/\/api\./, "arg 'production' → prod");
      },
    },
    {
      name: 'getFunctionsUrl: localhost in development AND testing, cloudfunctions otherwise',
      async run({ omega, assert }) {
        const functions = new RegExp(`^http://localhost:${localPort('functions')}/`);
        withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
          assert.match(omega.getFunctionsUrl(), functions, `dev → localhost:${localPort('functions')}`);
        });
        withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => {
          assert.match(omega.getFunctionsUrl(), functions, `testing → localhost:${localPort('functions')}`);
        });
        withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => {
          assert.match(omega.getFunctionsUrl(), /cloudfunctions\.net$/, 'prod → cloudfunctions.net');
        });
      },
    },
    {
      name: 'getWebsiteUrl: localhost:4000 in development AND testing, brand.url otherwise',
      async run({ omega, assert }) {
        // The scheme follows the local https stack (cp177): OMEGA_HTTPS_PORT set
        // (this process runs behind the mkcert proxy) → the website dev server
        // shares the same mkcert default → https. Unset → both sides plain http.
        // Controlled explicitly in BOTH directions so ambient env can't skew it.
        const savedHttpsPort = process.env.OMEGA_HTTPS_PORT;
        const website = localPort('website');
        try {
          delete process.env.OMEGA_HTTPS_PORT;
          withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
            assert.equal(omega.getWebsiteUrl(), `http://localhost:${website}`, `dev → localhost:${website}`);
          });
          withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => {
            assert.equal(omega.getWebsiteUrl(), `http://localhost:${website}`, `testing → localhost:${website}`);
          });

          process.env.OMEGA_HTTPS_PORT = '5002';
          withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
            assert.equal(omega.getWebsiteUrl(), `https://localhost:${website}`, 'dev behind the https proxy → https website');
          });

          withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => {
            const url = omega.getWebsiteUrl();
            assert.equal(url.includes('localhost'), false, 'prod → NOT localhost');
          });
        } finally {
          if (savedHttpsPort === undefined) delete process.env.OMEGA_HTTPS_PORT;
          else process.env.OMEGA_HTTPS_PORT = savedHttpsPort;
        }
      },
    },

    // ─── Parent helpers ALWAYS resolve live (never localhost), even in dev/testing ───

    {
      name: 'getParentApiUrl / getParentUrl never redirect to localhost (always live)',
      async run({ omega, assert }) {
        // Even under the test harness ('testing'), the parent is a real remote server.
        const parentUrl = omega.getParentUrl();
        const parentApi = omega.getParentApiUrl();
        assert.equal((parentUrl || '').includes('localhost'), false, 'getParentUrl not localhost');
        assert.equal((parentApi || '').includes('localhost'), false, 'getParentApiUrl not localhost');
        // When set, the parent API URL carries the api. subdomain.
        if (parentApi) assert.match(parentApi, /^https:\/\/api\./, 'parent api uses api. subdomain');
      },
    },
  ],
});
