/**
 * The one env reader and the boot guard it powers
 * ([#581](https://github.com/Omega-JS-Stack/omega/issues/581)).
 *
 * A brand's backend used to serve every route fine with a required key
 * missing and crash at the first customer action that needed it (#569: an
 * order email, at a real customer's first receipt). Now `omega.initialize()`
 * validates every required key of the env schema and refuses — in EVERY
 * environment, development included — with ONE error that names them all.
 * The single exempt lane is a process with no consumer omega.json5: the
 * framework booting itself, where there is no brand for a manage run to have
 * minted keys into. (The self-test fixture IS brand-shaped and gets its keys
 * seeded — see ensureFixtureEnv in cli/commands/test.js.)
 *
 * Real everything: the real reader, the real omega module booted against
 * real temp project dirs. Plain-node unit test (no emulator, no network).
 *
 * Run: npx omega test framework:helpers/env-reader
 */

const expect = require('../../dist/vendor/devkit/test/expect.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { baseMissingKeys } = require('../../dist/vendor/config/index.js');
const { getEnvironment } = require('../../dist/vendor/config/environment.js');

const env = require('../../dist/omega/libraries/env.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const OMEGA_PATH = require.resolve('../../dist/omega/index.js');
const REQUIRED = baseMissingKeys({}, { target: 'backend', verb: 'start' }).map((row) => row.key);

/** A FRESH omega module, so the boot latches start unset. */
function freshOmegaModule() {
  delete require.cache[OMEGA_PATH];

  return require(OMEGA_PATH);
}

/** A temp project dir, with a brand's config/omega.json5 when asked for one. */
function projectDir({ consumerConfig }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-guard-'));

  // The boot reads the project manifest for its name/version
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }));

  if (consumerConfig) {
    fs.mkdirSync(path.join(dir, 'config'));
    fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), JSON.stringify({
      brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
      targets: { backend: { type: 'backend' } },
    }));
  }

  return dir;
}

/**
 * Run `thunk` with `vars` applied to process.env (null deletes), restoring
 * every touched name afterwards — a leaked value would steer the environment
 * resolution of every later test in the run.
 */
function withEnv(vars, thunk) {
  const saved = {};
  for (const [name, value] of Object.entries(vars)) {
    saved[name] = process.env[name];
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    return thunk();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// The ONE input getEnvironment() reads
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)), spelled as the
// env var it is: a case that wants an environment NAMES it, and the ambient
// signals the runner's own process carries no longer override it.
const PRODUCTION = { OMEGA_ENVIRONMENT: 'production' };
const DEVELOPMENT = { OMEGA_ENVIRONMENT: 'development' };

/**
 * Boot a real omega in `development` with every required key absent,
 * restoring the process env afterwards — a leaked delete would break every
 * later test in the run.
 */
function bootWithoutRequiredKeys({ consumerConfig }) {
  const saved = { OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT };
  for (const name of REQUIRED) {
    saved[name] = process.env[name];
    delete process.env[name];
  }

  // The boot leaves a named input exactly as it is (#817), so naming
  // development here is what makes this boot a development boot
  process.env.OMEGA_ENVIRONMENT = 'development';

  const dir = projectDir({ consumerConfig: consumerConfig });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const { Omega } = freshOmegaModule();
    const omega = new Omega().initialize({ cwd: dir, runnerHost: true });

    // Read INSIDE the boot's env: the finally below puts the runner's own
    // input back, and this boot's answer is the one it named
    return { omega, warnings, environment: omega.getEnvironment() };
  } finally {
    console.warn = originalWarn;
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/**
 * Boot a real omega with every REQUIRED key seeded (so the #581 guard is
 * satisfied and the CONDITIONAL one is what fires), the given consumer config
 * on disk, and the given environment. Restores the process env afterwards.
 */
function bootWithConfig({ config, environment }) {
  const saved = { OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT };
  for (const name of REQUIRED) {
    saved[name] = process.env[name];
    process.env[name] = 'fixture-value';
  }
  saved.RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
  delete process.env.RECAPTCHA_SECRET_KEY;

  // The one input again: this boot IS the environment it names (#817)
  process.env.OMEGA_ENVIRONMENT = environment;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-rules-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), JSON.stringify(config));

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const { Omega } = freshOmegaModule();
    new Omega().initialize({ cwd: dir, runnerHost: true });
    return { warnings };
  } finally {
    console.warn = originalWarn;
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// A brand whose config makes RECAPTCHA_SECRET_KEY mandatory: the client mints
// tokens the moment a site key exists, and the backend can never verify one
// without the secret half — the #507 403-on-every-protected-POST state.
const HALF_KEYED_CAPTCHA = {
  brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
  captcha: { providers: { recaptcha: { siteKey: '6Lfixture' } } },
  targets: { backend: { type: 'backend' } },
};

module.exports = defineCases({
  description: 'The one env reader (#581): declared keys only, and a boot that refuses without the required ones',
  type: 'group',

  tests: [
    {
      name: 'reading an undeclared key fails at the read, not at the symptom',

      run() {
        expect(() => env.get('NOT_IN_THE_ENV_SCHEMA')).toThrow((error) => {
          expect(error.name).toBe('UnknownEnvKeyError');
          expect(error.message).toMatch(/NOT_IN_THE_ENV_SCHEMA/);
          return true;
        });

        // A declared key resolves through the cascade, empty reading as absent
        const saved = process.env.GH_TOKEN;
        try {
          process.env.GH_TOKEN = 'fixture-token';
          expect(env.get('GH_TOKEN')).toBe('fixture-token');
          expect(env.has('GH_TOKEN')).toBe(true);

          process.env.GH_TOKEN = '';
          expect(env.has('GH_TOKEN')).toBe(false);
        } finally {
          if (saved === undefined) delete process.env.GH_TOKEN;
          else process.env.GH_TOKEN = saved;
        }
      },
    },

    {
      name: 'assertRequired() names EVERY missing key in one error, never a value',

      run() {
        const saved = {};
        for (const name of REQUIRED) {
          saved[name] = process.env[name];
          delete process.env[name];
        }
        // One key present proves the error lists only what is actually missing
        process.env[REQUIRED[0]] = 'fixture-value-present';

        try {
          expect(() => env.assertRequired('backend')).toThrow((error) => {
            expect(error.name).toBe('MissingEnvKeysError');
            expect(error.keys).toEqual(REQUIRED.slice(1));
            for (const name of REQUIRED.slice(1)) {
              expect(error.message.includes(name), `the error names ${name}`).toBeTruthy();
            }
            expect(!error.message.includes(REQUIRED[0]), 'the key that IS set is not reported missing').toBeTruthy();
            expect(!error.message.includes('fixture-value-present'), 'no value ever appears in the message').toBeTruthy();
            return true;
          });
        } finally {
          for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
          }
        }
      },
    },

    {
      name: "a brand's backend refuses to boot in development, naming the missing keys",

      run() {
        expect(() => bootWithoutRequiredKeys({ consumerConfig: true })).toThrow((error) => {
          expect(error.name).toBe('MissingEnvKeysError');
          for (const name of REQUIRED) {
            expect(error.message.includes(name), `the boot failure names ${name}`).toBeTruthy();
          }
          // The fix, not just the fault
          expect(error.message).toMatch(/omega manage/);
          return true;
        });
      },
    },

    {
      name: 'one key, every environment — the _DEV twin mechanism is gone (#586)',

      run() {
        // Ruled 2026-08-26: the `<KEY>_DEV` twins are replaced, before they
        // shipped, by `.env.<environment>` files overlaying the base `.env`.
        // The reader no longer decides WHICH name to read — the cascade has
        // already resolved the one name by the time anything reaches here, so
        // a read returns the same value in every environment.
        for (const vars of [DEVELOPMENT, PRODUCTION, { OMEGA_ENVIRONMENT: 'testing' }]) {
          withEnv({ ...vars, STRIPE_SECRET_KEY: 'sk_from_the_cascade' }, () => {
            expect(env.get('STRIPE_SECRET_KEY')).toBe('sk_from_the_cascade');
          });
        }

        // The twin names are not declared anywhere, so reading one is the
        // undeclared-key programmer error, not a silent undefined
        for (const name of ['STRIPE_SECRET_KEY_DEV', 'PAYPAL_CLIENT_SECRET_DEV', 'CHARGEBEE_API_KEY_DEV']) {
          expect(() => env.get(name), `${name} must not be a declared key`).toThrow((error) => {
            expect(error.name).toBe('UnknownEnvKeyError');
            return true;
          });
        }

        // …and a live-shaped value is TRUSTED now: the overlay is where a
        // local run puts its test credential, and no key gets a shape guard
        withEnv({ ...DEVELOPMENT, STRIPE_SECRET_KEY: 'sk_live_trusted' }, () => {
          expect(env.get('STRIPE_SECRET_KEY')).toBe('sk_live_trusted');
        });
      },
    },

    {
      name: 'env.getEnvironment() IS the one vocabulary the overlay files are named with (#586)',

      run() {
        // The reader re-exports the ONE environment module's function
        // ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)), under the
        // same name every other OMEGA surface calls it by: the bare
        // `environment()` alias it used to add is gone, and so is any second copy.
        expect(env.getEnvironment, "the reader re-exports @omega.js/config's module, never a second copy").toBe(getEnvironment);
        expect(env.environment, 'the bare alias is gone').toBe(undefined);

        withEnv(DEVELOPMENT, () => expect(env.getEnvironment()).toBe('development'));
        withEnv(PRODUCTION, () => expect(env.getEnvironment()).toBe('production'));
        withEnv({ OMEGA_ENVIRONMENT: 'testing' }, () => expect(env.getEnvironment()).toBe('testing'));
      },
    },

    {
      name: 'the framework booting itself (no consumer config) warns and boots',

      run() {
        const { warnings, environment } = bootWithoutRequiredKeys({ consumerConfig: false });

        expect(environment, 'the development branch was not reached').toBe('development');

        const guardWarnings = warnings.filter((line) => line.includes('required env'));
        expect(guardWarnings.length, `the fault is still said out loud, got ${guardWarnings.length}`).toBe(1);
        expect(guardWarnings[0]).toMatch(/\[@omega\.js\/backend:index\]/);
      },
    },

    {
      name: "assertRules() names the key its own config made mandatory, and the path that did (#626)",

      run() {
        withEnv({ RECAPTCHA_SECRET_KEY: null }, () => {
          expect(() => env.assertRules(HALF_KEYED_CAPTCHA)).toThrow((error) => {
            expect(error.name).toBe('MissingConditionalEnvKeysError');
            expect(error.keys).toEqual(['RECAPTCHA_SECRET_KEY']);
            // The BRAND-level key name, which is what a human sets, and the
            // config path that made it mandatory
            expect(error.message.includes('RECAPTCHA_SECRET_KEY'), 'the error names the key').toBeTruthy();
            expect(error.message.includes('captcha.providers.recaptcha.siteKey'), 'and the path that requires it').toBeTruthy();
            return true;
          });
        });

        // The same config with the key present owes nothing…
        withEnv({ RECAPTCHA_SECRET_KEY: 'fixture-secret' }, () => {
          expect(env.assertRules(HALF_KEYED_CAPTCHA)).toBe(undefined);
        });

        // …and a brand that never set the site key owes nothing either: the
        // rule is one-directional, and an unkeyed brand is sanctioned (#17)
        withEnv({ RECAPTCHA_SECRET_KEY: null }, () => {
          expect(env.assertRules({ brand: { id: 'fixture' } })).toBe(undefined);
        });
      },
    },

    {
      name: 'a production boot REFUSES on a conditional key, development warns and continues (#626)',

      run() {
        expect(() => bootWithConfig({ config: HALF_KEYED_CAPTCHA, environment: 'production' })).toThrow((error) => {
          expect(error.name).toBe('MissingConditionalEnvKeysError');
          expect(error.message.includes('RECAPTCHA_SECRET_KEY'), 'the boot failure names the key').toBeTruthy();
          return true;
        });

        const { warnings } = bootWithConfig({ config: HALF_KEYED_CAPTCHA, environment: 'development' });
        const ruleWarnings = warnings.filter((line) => line.includes('RECAPTCHA_SECRET_KEY'));
        expect(ruleWarnings.length, `one warning line, got ${ruleWarnings.length}`).toBe(1);
        expect(ruleWarnings[0]).toMatch(/\[@omega\.js\/backend:index\]/);
        expect(ruleWarnings[0].includes('captcha.providers.recaptcha.siteKey'), 'the warning names the path too').toBeTruthy();
      },
    },
  ],
});
