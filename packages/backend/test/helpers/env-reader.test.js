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

const { requiredEnvKeys } = require('@omega.js/config');

const env = require('../../src/manager/libraries/env.js');

const MANAGER_PATH = require.resolve('../../src/manager/index.js');
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

module.exports = {
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
      name: 'the _DEV twin wins outside production and reads as absent in production (#586)',

      run() {
        const both = { STRIPE_SECRET_KEY: 'sk_test_plain', STRIPE_SECRET_KEY_DEV: 'sk_test_devtwin' };

        // Outside production the twin is the value — the emulator can never
        // reach the account the plain key names
        withEnv({ ...DEVELOPMENT, ...both }, () => {
          assert.strictEqual(env.get('STRIPE_SECRET_KEY'), 'sk_test_devtwin');
          assert.strictEqual(env.get('STRIPE_SECRET_KEY_DEV'), 'sk_test_devtwin');
        });

        // …and the plain key still serves when no twin is set
        withEnv({ ...DEVELOPMENT, STRIPE_SECRET_KEY: 'sk_test_plain', STRIPE_SECRET_KEY_DEV: null }, () => {
          assert.strictEqual(env.get('STRIPE_SECRET_KEY'), 'sk_test_plain');
          assert.strictEqual(env.has('STRIPE_SECRET_KEY_DEV'), false);
        });

        // In production the twin does not exist — a stale row that survived
        // into the artifact can never redirect a real customer's payment
        withEnv({ ...PRODUCTION, ...both }, () => {
          assert.strictEqual(env.get('STRIPE_SECRET_KEY'), 'sk_test_plain');
          assert.strictEqual(env.get('STRIPE_SECRET_KEY_DEV'), undefined);
          assert.strictEqual(env.has('STRIPE_SECRET_KEY_DEV'), false);
        });

        // The other three twins answer the same way
        withEnv({ ...DEVELOPMENT, STRIPE_WEBHOOK_SECRET: 'whsec_plain', STRIPE_WEBHOOK_SECRET_DEV: 'whsec_dev' }, () => {
          assert.strictEqual(env.get('STRIPE_WEBHOOK_SECRET'), 'whsec_dev');
        });
        withEnv({ ...DEVELOPMENT, PAYPAL_CLIENT_SECRET: 'pp-plain', PAYPAL_CLIENT_SECRET_DEV: 'pp-sandbox' }, () => {
          assert.strictEqual(env.get('PAYPAL_CLIENT_SECRET'), 'pp-sandbox');
        });
        withEnv({ ...DEVELOPMENT, CHARGEBEE_API_KEY: 'test_plain', CHARGEBEE_API_KEY_DEV: 'test_dev' }, () => {
          assert.strictEqual(env.get('CHARGEBEE_API_KEY'), 'test_dev');
        });
      },
    },

    {
      name: 'a LIVE-shaped payment secret is refused outside production, by name and never by value (#586)',

      run() {
        withEnv({ ...DEVELOPMENT, STRIPE_SECRET_KEY: 'sk_live_SECRETVALUE', STRIPE_SECRET_KEY_DEV: null }, () => {
          assert.throws(() => env.get('STRIPE_SECRET_KEY'), (error) => {
            assert.strictEqual(error.name, 'LiveSecretOutsideProductionError');
            assert.ok(error.message.includes('STRIPE_SECRET_KEY'), 'the refusal names the key');
            assert.ok(error.message.includes('STRIPE_SECRET_KEY_DEV'), 'the refusal names the fix');
            assert.ok(error.message.includes('development'), 'the refusal names the environment');
            assert.ok(!error.message.includes('sk_live_SECRETVALUE'), 'no secret value ever appears in the message');
            return true;
          });
        });

        // A restricted live key charges real cards too
        withEnv({ ...DEVELOPMENT, STRIPE_SECRET_KEY: 'rk_live_SECRETVALUE', STRIPE_SECRET_KEY_DEV: null }, () => {
          assert.throws(() => env.get('STRIPE_SECRET_KEY'), /LIVE/);
        });

        // …and a live key pasted into the TWIN is refused under the twin's name
        withEnv({ ...DEVELOPMENT, STRIPE_SECRET_KEY: 'sk_test_plain', STRIPE_SECRET_KEY_DEV: 'sk_live_OOPS' }, () => {
          assert.throws(() => env.get('STRIPE_SECRET_KEY'), (error) => {
            assert.strictEqual(error.name, 'LiveSecretOutsideProductionError');
            assert.ok(error.message.includes('STRIPE_SECRET_KEY_DEV'), 'the refusal names the key that carried the value');
            return true;
          });
        });

        // Chargebee's live sites announce themselves the same way
        withEnv({ ...DEVELOPMENT, CHARGEBEE_API_KEY: 'live_SECRETVALUE', CHARGEBEE_API_KEY_DEV: null }, () => {
          assert.throws(() => env.get('CHARGEBEE_API_KEY'), (error) => {
            assert.strictEqual(error.name, 'LiveSecretOutsideProductionError');
            return true;
          });
        });

        // In production a live key IS the point
        withEnv({ ...PRODUCTION, STRIPE_SECRET_KEY: 'sk_live_SECRETVALUE', STRIPE_SECRET_KEY_DEV: null }, () => {
          assert.strictEqual(env.get('STRIPE_SECRET_KEY'), 'sk_live_SECRETVALUE');
        });

        // A test-shaped key is never refused anywhere
        withEnv({ ...DEVELOPMENT, STRIPE_SECRET_KEY: 'sk_test_fine', STRIPE_SECRET_KEY_DEV: null }, () => {
          assert.strictEqual(env.get('STRIPE_SECRET_KEY'), 'sk_test_fine');
        });
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
  ],
};
