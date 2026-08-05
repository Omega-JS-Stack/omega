/**
 * Test: the generated rules stamp is the rules SCHEMA version
 * ([#175](https://github.com/Omega-JS-Stack/omega/issues/175)).
 *
 * The stamp used to be the @omega.js/backend package version, so every release
 * rewrote every consumer's `firestore.rules` + `database.rules.json` on the
 * next dev boot and dirtied their tree for nothing. It is now RULES_VERSION,
 * a constant that moves only when the generated rule semantics move.
 *
 * Run: npx omega test backend:cli/rules-version
 */
const fs = require('fs');
const path = require('path');
const SetupCommand = require('../../src/cli/commands/setup.js');
const { RULES_VERSION } = SetupCommand;

const SETUP_SOURCE = path.join(__dirname, '..', '..', 'src', 'cli', 'commands', 'setup.js');
const TEST_SOURCE = path.join(__dirname, '..', '..', 'src', 'cli', 'commands', 'test.js');

// The generator (SetupCommand#getRulesFile) only touches `main.default`, so a
// bare main is enough to run it: no project, no config, no emulator.
// `default.version` is the package-version channel, so a sentinel there proves
// the stamp does not read it.
const PACKAGE_VERSION_SENTINEL = '9.9.9-sentinel';

function generateRules() {
  const main = {
    firebaseProjectPath: process.cwd(),
    argv: {},
    options: {},
    default: { version: PACKAGE_VERSION_SENTINEL },
  };

  new SetupCommand(main).getRulesFile();

  return main.default;
}

module.exports = {
  description: 'Generated rules stamp: the rules schema version, not the package version',
  type: 'group',

  tests: [
    {
      name: 'both-rules-files-carry-the-schema-version-stamp',
      async run({ assert }) {
        const generated = generateRules();
        const stamp = `// ========== OMEGA Rules (v${RULES_VERSION}) ==========`;

        assert.equal(typeof RULES_VERSION, 'string', 'RULES_VERSION must be exported by the generator');
        assert.equal(generated.firestoreRulesWhole.includes(stamp), true, `firestore.rules must carry ${stamp}`);
        assert.equal(generated.databaseRulesWhole.includes(stamp), true, `database.rules.json must carry ${stamp}`);
        assert.equal(generated.firestoreRulesWhole.includes('(v0.0.0)'), false, 'the template placeholder must be replaced');
        assert.equal(generated.databaseRulesWhole.includes('(v0.0.0)'), false, 'the template placeholder must be replaced');
      },
    },

    {
      name: 'the-stamp-never-reads-the-package-version',
      async run({ assert }) {
        const generated = generateRules();

        assert.equal(generated.firestoreRulesWhole.includes(PACKAGE_VERSION_SENTINEL), false, 'firestore.rules must not stamp the package version');
        assert.equal(generated.databaseRulesWhole.includes(PACKAGE_VERSION_SENTINEL), false, 'database.rules.json must not stamp the package version');
      },
    },

    {
      name: 'the-setup-version-check-expects-the-same-stamp',
      async run({ assert }) {
        // Source-level: the check lives inside runSetup(), which needs a real
        // project to execute. If it drifts back to the package version it
        // never matches what the generator writes, and setup rewrites both
        // rules files on every single boot, the exact churn this pins.
        const source = fs.readFileSync(SETUP_SOURCE, 'utf8');
        const line = source.split('\n').find((l) => l.includes('rulesVersionRegex ='));

        assert.equal(!!line, true, 'the rulesVersionRegex assignment must exist in setup.js');
        assert.equal(line.includes('RULES_VERSION'), true, 'the version check must build its regex from RULES_VERSION');
        assert.equal(line.includes('self.default.version'), false, 'the version check must not read the package version');
      },
    },

    {
      name: 'the-emulator-fixture-stamp-reads-the-same-constant',
      async run({ assert }) {
        // Source-level: the fixture stamp lives in TestCommand#ensureFixtureRules,
        // which needs the fixture project to execute. It is the SECOND generator
        // of the same file — stamping a package version there re-dirties the
        // fixture on every release, and setup rewrites it back on the next boot.
        const source = fs.readFileSync(TEST_SOURCE, 'utf8');
        const stamp = source.split('\n').find((l) => l.includes("replace('(v0.0.0)'"));

        assert.equal(!!stamp, true, 'the fixture rules stamp must exist in test.js');
        assert.equal(stamp.includes('RULES_VERSION'), true, 'the fixture stamp must use RULES_VERSION');
        assert.equal(/RULES_VERSION.*require\('\.\/setup'\)/.test(source), true, 'RULES_VERSION must come from the setup.js export, not a second copy');
        assert.equal(source.includes("package.json').version"), false, 'the fixture stamp must not read the package version');
      },
    },
  ],
};
