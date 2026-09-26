/**
 * A REAL Omega instance, booted fresh against the bundled fixture project, for
 * the suites that must also run with no emulator (the runner hands its own
 * booted `omega` to every other case).
 *
 * Fresh means `new Omega()`, never the package's singleton: re-initializing
 * the instance the runner booted would swap its config under every later
 * suite. The boot is the test-runner boot (OMEGA_TEST_RUNNER: no Firebase
 * init, no function wiring), and the fixture's required env keys are seeded
 * the way the test command's `ensureFixtureEnv` seeds them, for the boot
 * only. A process no lane has named an environment for is named `testing`,
 * and stays named: every Context reads it.
 *
 * `_`-prefixed: the runner skips it in discovery (a helper, not a suite).
 */
const path = require('node:path');
const { requiredEnvKeys } = require('./_shared-config.js');
const { Omega } = require('../../dist/omega/index.js');

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'dist', 'test', 'fixtures', 'firebase-project');

/**
 * Boot a fresh instance.
 * @param {Omega} [instance] - the instance to initialize (a new one by default).
 * @returns {Omega} what initialize() returned.
 */
function bootOmega(instance = new Omega()) {
  const saved = {};
  const set = (key, value) => {
    saved[key] = process.env[key];
    process.env[key] = value;
  };

  if (!process.env.OMEGA_ENVIRONMENT) {
    process.env.OMEGA_ENVIRONMENT = 'testing';
  }

  set('OMEGA_TEST_RUNNER', '1');

  requiredEnvKeys('backend')
    .filter((key) => !process.env[key])
    .forEach((key) => set(key, `fixture-${key.toLowerCase().replace(/_/g, '-')}`));

  try {
    return instance.initialize({ cwd: FIXTURE_DIR });
  } finally {
    Object.entries(saved).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

module.exports = { bootOmega, FIXTURE_DIR };
