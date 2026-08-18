/**
 * Test: the generated rules stamp is the rules SCHEMA version
 * ([#175](https://github.com/Omega-JS-Stack/omega/issues/175)).
 *
 * The stamp used to be the @omega.js/backend package version, so every release
 * rewrote every consumer's rules files on the next dev boot and dirtied their
 * tree for nothing. It is now RULES_VERSION, a constant that moves only when
 * the generated rule semantics move.
 *
 * Since [#255](https://github.com/Omega-JS-Stack/omega/issues/255) the two
 * rules files carry it differently: `database.rules.json` still regenerates a
 * marker block, while `firestore.rules` is COMPILED and the stamp rides the
 * generated artifact's header. Both read the same constant, whose one home is
 * the compiler (src/cli/utils/compile-rules.js).
 *
 * Run: npx omega test backend:cli/rules-version
 */
const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');
const SetupCommand = require('../../src/cli/commands/setup.js');
const { RULES_VERSION } = SetupCommand;
const { BRAND_RULES_SEED, compileRules } = require('../../src/cli/utils/compile-rules.js');

const SETUP_SOURCE = path.join(__dirname, '..', '..', 'src', 'cli', 'commands', 'setup.js');
const COMPILER_SOURCE = path.join(__dirname, '..', '..', 'src', 'cli', 'utils', 'compile-rules.js');

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
      name: 'the-realtime-marker-block-carries-the-schema-version-stamp',
      async run({ assert }) {
        const generated = generateRules();
        const stamp = `// ========== OMEGA Rules (v${RULES_VERSION}) ==========`;

        assert.equal(typeof RULES_VERSION, 'string', 'RULES_VERSION must be exported by the generator');
        assert.equal(generated.databaseRulesWhole.includes(stamp), true, `database.rules.json must carry ${stamp}`);
        assert.equal(generated.databaseRulesWhole.includes('(v0.0.0)'), false, 'the template placeholder must be replaced');
      },
    },

    {
      name: 'the-compiled-firestore-artifact-stamps-the-same-constant',
      async run({ assert }) {
        const { compiled } = compileRules({ brandSource: jetpack.read(BRAND_RULES_SEED) });

        assert.equal(compiled.includes(`rules schema v${RULES_VERSION}`), true, `the compiled artifact must carry the v${RULES_VERSION} stamp`);
        assert.equal(compiled.includes('OMEGA Rules (v'), false, 'the compiled model carries no marker block');
      },
    },

    {
      name: 'the-stamp-never-reads-the-package-version',
      async run({ assert }) {
        const generated = generateRules();
        const { compiled } = compileRules({ brandSource: jetpack.read(BRAND_RULES_SEED) });

        assert.equal(generated.databaseRulesWhole.includes(PACKAGE_VERSION_SENTINEL), false, 'database.rules.json must not stamp the package version');
        assert.equal(compiled.includes(PACKAGE_VERSION_SENTINEL), false, 'the compiled artifact must not stamp the package version');
        assert.equal(fs.readFileSync(COMPILER_SOURCE, 'utf8').includes("package.json').version"), false, 'the compiler must not read the package version');
      },
    },

    {
      name: 'the-setup-version-check-expects-the-same-stamp',
      async run({ assert }) {
        // Source-level: the check lives inside runSetup(), which needs a real
        // project to execute. If it drifts back to the package version it
        // never matches what the generator writes, and setup rewrites
        // database.rules.json on every single boot, the exact churn this pins.
        const source = fs.readFileSync(SETUP_SOURCE, 'utf8');
        const line = source.split('\n').find((l) => l.includes('rulesVersionRegex ='));

        assert.equal(!!line, true, 'the rulesVersionRegex assignment must exist in setup.js');
        assert.equal(line.includes('RULES_VERSION'), true, 'the version check must build its regex from RULES_VERSION');
        assert.equal(line.includes('self.default.version'), false, 'the version check must not read the package version');
        assert.equal(/RULES_VERSION.*require\('\.\.\/utils\/compile-rules'\)/.test(source), true, 'RULES_VERSION must come from the compiler, not a second copy');
      },
    },
  ],
};
