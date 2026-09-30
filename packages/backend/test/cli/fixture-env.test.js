/**
 * Test: the self-test fixture's `.env` seeding (`ensureFixtureEnv`).
 *
 * The seeder appends every env-schema REQUIRED key the fixture's `.env` does
 * not already set, and "already set" is what dotenv reads, the reader every
 * OMEGA loader uses, so a value in a form another reader skips is never
 * duplicated. Offline by construction: a temp fixture, only the seeder runs.
 *
 * Run: npx omega test backend:cli/fixture-env
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');
const jetpack = require('fs-jetpack');

const TestCommand = require('../../dist/cli/commands/test.js');
const { requiredEnvKeys } = require('../../dist/vendor/config/index.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/** Run the seeder against a temp fixture holding `existing` (null: no .env). */
function seed(existing) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-fixture-env-'));
  const envPath = path.join(fixture, '.env');
  if (existing !== null) jetpack.write(envPath, existing);

  new TestCommand({ firebaseProjectPath: fixture, argv: {}, options: {} }).ensureFixtureEnv(fixture);
  return { fixture, envPath };
}

module.exports = defineCases({
  description: 'the self-test fixture .env seeding',
  type: 'group',

  tests: [
    {
      name: 'a-required-key-set-in-a-quote-wrapped-form-is-not-duplicated',
      run({ assert }) {
        // dotenv reads `""wrapped""` as `"wrapped"`; util.parseEnv reads it empty
        const { fixture, envPath } = seed('OMEGA_ADMIN_KEY=""wrapped""\n');
        try {
          const content = jetpack.read(envPath);
          assert.equal(content.match(/^\s*(?:export\s+)?OMEGA_ADMIN_KEY\s*=/gm).length, 1);
          assert.equal(dotenv.parse(content).OMEGA_ADMIN_KEY, '"wrapped"');
        } finally {
          jetpack.remove(fixture);
        }
      },
    },

    {
      name: 'every-required-key-reads-back-through-dotenv-after-the-run',
      run({ assert }) {
        const { fixture, envPath } = seed(null);
        try {
          const read = dotenv.parse(jetpack.read(envPath));
          for (const key of requiredEnvKeys('backend')) {
            assert.ok(read[key], `${key} is not set after the run`);
          }
        } finally {
          jetpack.remove(fixture);
        }
      },
    },

    {
      name: 'a-second-run-changes-nothing',
      run({ assert }) {
        const { fixture, envPath } = seed('MINE="keep"\n');
        try {
          const first = jetpack.read(envPath);
          new TestCommand({ firebaseProjectPath: fixture, argv: {}, options: {} }).ensureFixtureEnv(fixture);
          assert.equal(jetpack.read(envPath), first);
        } finally {
          jetpack.remove(fixture);
        }
      },
    },
  ],
});
