/**
 * The one env reader and the boot guard it powers
 * ([#581](https://github.com/Omega-JS-Stack/omega/issues/581)).
 *
 * A brand's backend used to serve every route fine with a required key
 * missing and crash at the first customer action that needed it (#569: an
 * order email, at a real customer's first receipt). Now `Manager.init()`
 * validates every required key of the env schema and refuses — in EVERY
 * environment, development included — with ONE error that names them all.
 * The single exempt lane is a process with no consumer omega.json5: the
 * framework booting itself, where there is no brand for a manage run to have
 * minted keys into. (The self-test fixture IS brand-shaped and gets its keys
 * seeded — see ensureFixtureEnv in cli/commands/test.js.)
 *
 * Real everything: the real reader, the real Manager module booted against
 * real temp project dirs. Plain-node unit test (no emulator, no network).
 *
 * Run: npx omega test framework:helpers/env-reader
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { requiredEnvKeys, envEnvironment } = require('../../dist/vendor/config/index.js');

const env = require('../../dist/manager/libraries/env.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const MANAGER_PATH = require.resolve('../../dist/manager/index.js');
const REQUIRED = requiredEnvKeys('backend');

/** A FRESH Manager module, so the boot latches start unset. */
function freshManagerModule() {
  delete require.cache[MANAGER_PATH];

  return require(MANAGER_PATH);
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
      targets: { backend: {} },
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

// The two environment signals getEnvironment() reads, spelled as env vars:
// testing wins over everything, so a production case has to silence the
// runner's own OMEGA_TEST_MODE
const PRODUCTION = { OMEGA_TEST_MODE: null, ENVIRONMENT: 'production' };
const DEVELOPMENT = { OMEGA_TEST_MODE: null, ENVIRONMENT: 'development' };

/**
 * Boot a real Manager in `development` with every required key absent,
 * restoring the process env afterwards — a leaked delete would break every
 * later test in the run.
 */
function bootWithoutRequiredKeys({ consumerConfig }) {
  const saved = { OMEGA_TEST_MODE: process.env.OMEGA_TEST_MODE, ENVIRONMENT: process.env.ENVIRONMENT };
  for (const name of REQUIRED) {
    saved[name] = process.env[name];
    delete process.env[name];
  }

  // getEnvironment() reads these live on every call: testing wins over
  // everything, so the runner's own OMEGA_TEST_MODE has to step aside for
  // this boot to BE a development boot
  delete process.env.OMEGA_TEST_MODE;
  process.env.ENVIRONMENT = 'development';

  const dir = projectDir({ consumerConfig: consumerConfig });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const FreshManager = freshManagerModule();
    const manager = new FreshManager();
    manager.init(null, { cwd: dir, log: false });

    // Resolved INSIDE the boot's env: getEnvironment() reads live, and the
    // finally below puts the runner's own test-mode signal back
    return { manager, warnings, environment: manager.getEnvironment() };
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
 * Boot a real Manager with every REQUIRED key seeded (so the #581 guard is
 * satisfied and the CONDITIONAL one is what fires), the given consumer config
 * on disk, and the given environment. Restores the process env afterwards.
 */
function bootWithConfig({ config, environment }) {
  const saved = { OMEGA_TEST_MODE: process.env.OMEGA_TEST_MODE, ENVIRONMENT: process.env.ENVIRONMENT };
  for (const name of REQUIRED) {
    saved[name] = process.env[name];
    process.env[name] = 'fixture-value';
  }
  saved.RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
  delete process.env.RECAPTCHA_SECRET_KEY;

  delete process.env.OMEGA_TEST_MODE;
  process.env.ENVIRONMENT = environment;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-rules-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), JSON.stringify(config));

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const FreshManager = freshManagerModule();
    new FreshManager().init(null, { cwd: dir, log: false });
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
  targets: { backend: {} },
};

module.exports = defineCases({
  description: 'The one env reader (#581): declared keys only, and a boot that refuses without the required ones',
  type: 'group',

  tests: [
    {
      name: 'reading an undeclared key fails at the read, not at the symptom',

      run() {
        assert.throws(() => env.get('NOT_IN_THE_ENV_SCHEMA'), (error) => {
          assert.strictEqual(error.name, 'UnknownEnvKeyError');
          assert.match(error.message, /NOT_IN_THE_ENV_SCHEMA/);
          return true;
        });

        // A declared key resolves through the cascade, empty reading as absent
        const saved = process.env.GH_TOKEN;
        try {
          process.env.GH_TOKEN = 'fixture-token';
          assert.strictEqual(env.get('GH_TOKEN'), 'fixture-token');
          assert.strictEqual(env.has('GH_TOKEN'), true);

          process.env.GH_TOKEN = '';
          assert.strictEqual(env.has('GH_TOKEN'), false);
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
          assert.throws(() => env.assertRequired('backend'), (error) => {
            assert.strictEqual(error.name, 'MissingEnvKeysError');
            assert.deepStrictEqual(error.keys, REQUIRED.slice(1));
            for (const name of REQUIRED.slice(1)) {
              assert.ok(error.message.includes(name), `the error names ${name}`);
            }
            assert.ok(!error.message.includes(REQUIRED[0]), 'the key that IS set is not reported missing');
            assert.ok(!error.message.includes('fixture-value-present'), 'no value ever appears in the message');
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
        assert.throws(() => bootWithoutRequiredKeys({ consumerConfig: true }), (error) => {
          assert.strictEqual(error.name, 'MissingEnvKeysError');
          for (const name of REQUIRED) {
            assert.ok(error.message.includes(name), `the boot failure names ${name}`);
          }
          // The fix, not just the fault
          assert.match(error.message, /omega manage/);
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
        for (const vars of [DEVELOPMENT, PRODUCTION, { ...DEVELOPMENT, OMEGA_TEST_MODE: 'true' }]) {
          withEnv({ ...vars, STRIPE_SECRET_KEY: 'sk_from_the_cascade' }, () => {
            assert.strictEqual(env.get('STRIPE_SECRET_KEY'), 'sk_from_the_cascade');
          });
        }

        // The twin names are not declared anywhere, so reading one is the
        // undeclared-key programmer error, not a silent undefined
        for (const name of ['STRIPE_SECRET_KEY_DEV', 'PAYPAL_CLIENT_SECRET_DEV', 'CHARGEBEE_API_KEY_DEV']) {
          assert.throws(() => env.get(name), (error) => {
            assert.strictEqual(error.name, 'UnknownEnvKeyError');
            return true;
          }, `${name} must not be a declared key`);
        }

        // …and a live-shaped value is TRUSTED now: the overlay is where a
        // local run puts its test credential, and no key gets a shape guard
        withEnv({ ...DEVELOPMENT, STRIPE_SECRET_KEY: 'sk_live_trusted' }, () => {
          assert.strictEqual(env.get('STRIPE_SECRET_KEY'), 'sk_live_trusted');
        });
      },
    },

    {
      name: 'env.environment() IS the one vocabulary the overlay files are named with (#586)',

      run() {
        assert.strictEqual(env.environment, envEnvironment, "the reader re-exports @omega.js/config's resolver, never a second copy");

        withEnv(DEVELOPMENT, () => assert.strictEqual(env.environment(), 'development'));
        withEnv(PRODUCTION, () => assert.strictEqual(env.environment(), 'production'));
        withEnv({ ...DEVELOPMENT, OMEGA_TEST_MODE: 'true' }, () => assert.strictEqual(env.environment(), 'testing'));
      },
    },

    {
      name: 'the framework booting itself (no consumer config) warns and boots',

      run() {
        const { warnings, environment } = bootWithoutRequiredKeys({ consumerConfig: false });

        assert.strictEqual(environment, 'development', 'the development branch was not reached');

        const guardWarnings = warnings.filter((line) => line.includes('required env'));
        assert.strictEqual(guardWarnings.length, 1, `the fault is still said out loud, got ${guardWarnings.length}`);
        assert.match(guardWarnings[0], /\[@omega\.js\/backend:index\]/);
      },
    },

    {
      name: "assertRules() names the key its own config made mandatory, and the path that did (#626)",

      run() {
        withEnv({ RECAPTCHA_SECRET_KEY: null }, () => {
          assert.throws(() => env.assertRules(HALF_KEYED_CAPTCHA), (error) => {
            assert.strictEqual(error.name, 'MissingConditionalEnvKeysError');
            assert.deepStrictEqual(error.keys, ['RECAPTCHA_SECRET_KEY']);
            // The BRAND-level key name, which is what a human sets, and the
            // config path that made it mandatory
            assert.ok(error.message.includes('RECAPTCHA_SECRET_KEY'), 'the error names the key');
            assert.ok(error.message.includes('captcha.providers.recaptcha.siteKey'), 'and the path that requires it');
            return true;
          });
        });

        // The same config with the key present owes nothing…
        withEnv({ RECAPTCHA_SECRET_KEY: 'fixture-secret' }, () => {
          assert.strictEqual(env.assertRules(HALF_KEYED_CAPTCHA), undefined);
        });

        // …and a brand that never set the site key owes nothing either: the
        // rule is one-directional, and an unkeyed brand is sanctioned (#17)
        withEnv({ RECAPTCHA_SECRET_KEY: null }, () => {
          assert.strictEqual(env.assertRules({ brand: { id: 'fixture' } }), undefined);
        });
      },
    },

    {
      name: 'a production boot REFUSES on a conditional key, development warns and continues (#626)',

      run() {
        assert.throws(() => bootWithConfig({ config: HALF_KEYED_CAPTCHA, environment: 'production' }), (error) => {
          assert.strictEqual(error.name, 'MissingConditionalEnvKeysError');
          assert.ok(error.message.includes('RECAPTCHA_SECRET_KEY'), 'the boot failure names the key');
          return true;
        });

        const { warnings } = bootWithConfig({ config: HALF_KEYED_CAPTCHA, environment: 'development' });
        const ruleWarnings = warnings.filter((line) => line.includes('RECAPTCHA_SECRET_KEY'));
        assert.strictEqual(ruleWarnings.length, 1, `one warning line, got ${ruleWarnings.length}`);
        assert.match(ruleWarnings[0], /\[@omega\.js\/backend:index\]/);
        assert.ok(ruleWarnings[0].includes('captcha.providers.recaptcha.siteKey'), 'the warning names the path too');
      },
    },
  ],
});
