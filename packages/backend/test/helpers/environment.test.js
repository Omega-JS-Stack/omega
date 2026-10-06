/**
 * Test: environment detection + URL helpers
 * Covers the Omega instance's getEnvironment() SSOT, the derived is*() checks, the URL
 * builders (getApiUrl / getFunctionsUrl / getWebsiteUrl + parent variants), and the
 * ctx→omega forwarding.
 *
 * Run: npx omega test backend:helpers/environment
 *
 * Contract (see docs/backend/environment-detection.md):
 *   - getEnvironment() is @omega.js/config's, the ONE environment module every
 *     OMEGA target answers from ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)).
 *     It reads ONE input, `OMEGA_ENVIRONMENT`, which this backend's boot sets
 *     once from the .env cascade's own ambient answer (an already-named
 *     `OMEGA_ENVIRONMENT`, the test lane's `testing` among them, then an explicit
 *     ENVIRONMENT or FUNCTIONS_EMULATOR, else production for a deployed
 *     function). Returns exactly ONE of
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
  const KEYS = ['OMEGA_ENVIRONMENT', 'ENVIRONMENT', 'FUNCTIONS_EMULATOR', 'TERM_PROGRAM'];
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
      async run({ omega, expect }) {
        // The boot resolved the input once; nothing re-sniffs ENVIRONMENT or
        // FUNCTIONS_EMULATOR at read time any more (#817).
        withEnv({ OMEGA_ENVIRONMENT: 'testing', ENVIRONMENT: 'production' }, () => {
          expect(omega.getEnvironment()).toBe('testing');
        });
      },
    },
    {
      name: 'getEnvironment: production when the lane named production',
      async run({ omega, expect }) {
        withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => {
          expect(omega.getEnvironment()).toBe('production');
        });
      },
    },
    {
      name: 'getEnvironment: development when the lane named development',
      async run({ omega, expect }) {
        withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
          expect(omega.getEnvironment()).toBe('development');
        });
      },
    },
    {
      name: 'the boot resolves the input from the ambient answer: FUNCTIONS_EMULATOR is development',
      async run({ omega, expect }) {
        // envEnvironment() is the PRODUCER of the input, and the boot runs it
        // once. Its ambient rules are unchanged: an emulator run is development.
        withEnv({ FUNCTIONS_EMULATOR: 'true' }, () => {
          expect(envEnvironment()).toBe('development');
        });
        withEnv({ ENVIRONMENT: 'production' }, () => {
          expect(envEnvironment()).toBe('production');
        });
        withEnv({ OMEGA_ENVIRONMENT: 'testing', ENVIRONMENT: 'production' }, () => {
          expect(envEnvironment(), 'a test run is not production, whatever else says').toBe('testing');
        });
        withEnv({}, () => {
          expect(envEnvironment(), 'no signal is production, a deployed function carries none').toBe('production');
        });
        // And the input, once named, wins over every ambient signal.
        withEnv({ OMEGA_ENVIRONMENT: 'development', ENVIRONMENT: 'production' }, () => {
          expect(envEnvironment()).toBe('development');
        });
      },
    },
    {
      name: 'getEnvironment: NO default, a missing input is a loud error naming the variable',
      async run({ omega, expect }) {
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

          expect(thrown, 'a process whose lane named no environment must refuse, never answer').toBeTruthy();
          expect(thrown.message, `the refusal names the variable, got: ${thrown && thrown.message}`).toMatch(/OMEGA_ENVIRONMENT/);
        });
      },
    },

    {
      name: 'the test lane names testing through the one input, here and in the Functions runtime',
      auth: 'none',
      async run({ omega, http, expect }) {
        // The lane (the gate) sets OMEGA_ENVIRONMENT=testing on every child it
        // starts and no other test-run name, so this process reads it untouched.
        expect(process.env.OMEGA_ENVIRONMENT, 'the runner child carries the one input').toBe('testing');
        expect(process.env.OMEGA_TEST_MODE, 'the retired test-mode flag is set by no lane').toBe(undefined);
        expect(omega.isTesting(), 'isTesting() answers the test run').toBe(true);

        const response = await http.as('none').get('omega/health');

        expect(response, 'the liveness probe answers').toBeSuccess();
        expect(response.data.environment, 'the Functions runtime resolves testing from the same input').toBe('testing');
      },
    },

    // ─── The KEY invariant: is*() derive from getEnvironment() and can NEVER disagree ───

    {
      name: 'invariant: is*() exactly matches getEnvironment() across every scenario',
      async run({ omega, expect }) {
        const scenarios = [
          { env: { OMEGA_ENVIRONMENT: 'testing', ENVIRONMENT: 'production' }, expect: 'testing' },
          { env: { OMEGA_ENVIRONMENT: 'production' },                     expect: 'production' },
          { env: { OMEGA_ENVIRONMENT: 'development' },                    expect: 'development' },
        ];
        for (const s of scenarios) {
          withEnv(s.env, () => {
            const e = omega.getEnvironment();
            expect(e, `getEnvironment for ${JSON.stringify(s.env)}`).toBe(s.expect);
            // Each is*() must equal (getEnvironment() === its value) — no independent reads.
            expect(omega.isDevelopment(), `isDevelopment for ${e}`).toBe(e === 'development');
            expect(omega.isTesting(), `isTesting for ${e}`).toBe(e === 'testing');
            expect(omega.isProduction(), `isProduction for ${e}`).toBe(e === 'production');
          });
        }
      },
    },
    {
      name: 'invariant: exactly one of is*() is true in every scenario (mutually exclusive)',
      async run({ omega, expect }) {
        const envs = [
          { OMEGA_ENVIRONMENT: 'testing' },
          { OMEGA_ENVIRONMENT: 'production' },
          { OMEGA_ENVIRONMENT: 'development' },
        ];
        for (const env of envs) {
          withEnv(env, () => {
            const trueCount = [omega.isDevelopment(), omega.isTesting(), omega.isProduction()]
              .filter(Boolean).length;
            expect(trueCount, `exactly one true for ${JSON.stringify(env)}`).toBe(1);
          });
        }
      },
    },
    {
      name: 'isProduction is a real positive check (NOT just !isDevelopment) — false in testing',
      async run({ omega, expect }) {
        withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => {
          expect(omega.isDevelopment(), 'isDevelopment false in testing').toBe(false);
          expect(omega.isProduction(), 'isProduction false in testing').toBe(false);
          expect(omega.isTesting(), 'isTesting true in testing').toBe(true);
        });
      },
    },

    // ─── ctx forwards to the Omega instance (identical results) ───

    {
      name: 'ctx forwards getEnvironment()/is*() to the omega (identical)',
      async run({ omega, ctx, expect }) {
        const cases = [
          { OMEGA_ENVIRONMENT: 'testing' },
          { OMEGA_ENVIRONMENT: 'production' },
          { OMEGA_ENVIRONMENT: 'development' },
        ];
        for (const env of cases) {
          withEnv(env, () => {
            expect(ctx.getEnvironment(), 'getEnvironment forward').toBe(omega.getEnvironment());
            expect(ctx.isDevelopment(), 'isDevelopment forward').toBe(omega.isDevelopment());
            expect(ctx.isTesting(), 'isTesting forward').toBe(omega.isTesting());
            expect(ctx.isProduction(), 'isProduction forward').toBe(omega.isProduction());
          });
        }
      },
    },

    // ─── URL helpers: local in dev/testing, production otherwise ───

    {
      name: 'getApiUrl: localhost in development AND testing, prod otherwise',
      async run({ omega, expect }) {
        const hosting = `http://localhost:${localPort('hosting')}`;
        withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
          expect(omega.getApiUrl(), 'dev → localhost').toBe(hosting);
        });
        withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => {
          expect(omega.getApiUrl(), 'testing → localhost').toBe(hosting);
        });
        withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => {
          expect(omega.getApiUrl(), 'prod → api.<domain>').toMatch(/^https:\/\/api\./);
        });
      },
    },
    {
      name: 'getApiUrl: explicit env arg overrides current environment',
      async run({ omega, expect }) {
        // Under the test harness we're in 'testing', but an explicit arg forces the mapping.
        expect(omega.getApiUrl('development'), "arg 'development' → localhost").toBe(`http://localhost:${localPort('hosting')}`);
        expect(omega.getApiUrl('production'), "arg 'production' → prod").toMatch(/^https:\/\/api\./);
      },
    },
    {
      name: 'getFunctionsUrl: localhost in development AND testing, cloudfunctions otherwise',
      async run({ omega, expect }) {
        const functions = new RegExp(`^http://localhost:${localPort('functions')}/`);
        withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
          expect(omega.getFunctionsUrl(), `dev → localhost:${localPort('functions')}`).toMatch(functions);
        });
        withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => {
          expect(omega.getFunctionsUrl(), `testing → localhost:${localPort('functions')}`).toMatch(functions);
        });
        withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => {
          expect(omega.getFunctionsUrl(), 'prod → cloudfunctions.net').toMatch(/cloudfunctions\.net$/);
        });
      },
    },
    {
      name: 'getWebsiteUrl: localhost:4000 in development AND testing, brand.url otherwise',
      async run({ omega, expect }) {
        // The scheme follows the local https stack (cp177): OMEGA_HTTPS_PORT set
        // (this process runs behind the mkcert proxy) → the website dev server
        // shares the same mkcert default → https. Unset → both sides plain http.
        // Controlled explicitly in BOTH directions so ambient env can't skew it.
        const savedHttpsPort = process.env.OMEGA_HTTPS_PORT;
        const website = localPort('website');
        try {
          delete process.env.OMEGA_HTTPS_PORT;
          withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
            expect(omega.getWebsiteUrl(), `dev → localhost:${website}`).toBe(`http://localhost:${website}`);
          });
          withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => {
            expect(omega.getWebsiteUrl(), `testing → localhost:${website}`).toBe(`http://localhost:${website}`);
          });

          process.env.OMEGA_HTTPS_PORT = '5002';
          withEnv({ OMEGA_ENVIRONMENT: 'development' }, () => {
            expect(omega.getWebsiteUrl(), 'dev behind the https proxy → https website').toBe(`https://localhost:${website}`);
          });

          withEnv({ OMEGA_ENVIRONMENT: 'production' }, () => {
            const url = omega.getWebsiteUrl();
            expect(url.includes('localhost'), 'prod → NOT localhost').toBe(false);
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
      async run({ omega, expect }) {
        // Even under the test harness ('testing'), the parent is a real remote server.
        const parentUrl = omega.getParentUrl();
        const parentApi = omega.getParentApiUrl();
        expect((parentUrl || '').includes('localhost'), 'getParentUrl not localhost').toBe(false);
        expect((parentApi || '').includes('localhost'), 'getParentApiUrl not localhost').toBe(false);
        // When set, the parent API URL carries the api. subdomain.
        if (parentApi) expect(parentApi, 'parent api uses api. subdomain').toMatch(/^https:\/\/api\./);
      },
    },
  ],
});
