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
const targetChecks = require('../../dist/cli/utils/target-checks.js');
const { RULES_VERSION } = targetChecks;
const { BRAND_RULES_SEED, compileRules } = require('../../dist/cli/utils/compile-rules.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const SETUP_SOURCE = path.join(__dirname, '..', '..', 'dist', 'cli', 'utils', 'target-checks.js');
const COMPILER_SOURCE = path.join(__dirname, '..', '..', 'dist', 'cli', 'utils', 'compile-rules.js');

// The generator (target-checks' getRulesFile) only touches `main.default`, so
// a bare main is enough to run it: no project, no config, no emulator.
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

  targetChecks.getRulesFile(main);

  return main.default;
}

module.exports = defineCases({
  description: 'Generated rules stamp: the rules schema version, not the package version',
  type: 'group',

  tests: [
    {
      name: 'the-realtime-marker-block-carries-the-schema-version-stamp',
      async run({ expect }) {
        const generated = generateRules();
        const stamp = `// ========== OMEGA Rules (v${RULES_VERSION}) ==========`;

        expect(typeof RULES_VERSION, 'RULES_VERSION must be exported by the generator').toBe('string');
        expect(generated.databaseRulesWhole.includes(stamp), `database.rules.json must carry ${stamp}`).toBe(true);
        expect(generated.databaseRulesWhole.includes('(v0.0.0)'), 'the template placeholder must be replaced').toBe(false);
      },
    },

    {
      name: 'the-compiled-firestore-artifact-stamps-the-same-constant',
      async run({ expect }) {
        const { compiled } = compileRules({ brandSource: jetpack.read(BRAND_RULES_SEED) });

        expect(compiled.includes(`rules schema v${RULES_VERSION}`), `the compiled artifact must carry the v${RULES_VERSION} stamp`).toBe(true);
        expect(compiled.includes('OMEGA Rules (v'), 'the compiled model carries no marker block').toBe(false);
      },
    },

    {
      name: 'the-stamp-never-reads-the-package-version',
      async run({ expect }) {
        const generated = generateRules();
        const { compiled } = compileRules({ brandSource: jetpack.read(BRAND_RULES_SEED) });

        expect(generated.databaseRulesWhole.includes(PACKAGE_VERSION_SENTINEL), 'database.rules.json must not stamp the package version').toBe(false);
        expect(compiled.includes(PACKAGE_VERSION_SENTINEL), 'the compiled artifact must not stamp the package version').toBe(false);
        expect(fs.readFileSync(COMPILER_SOURCE, 'utf8').includes("package.json').version"), 'the compiler must not read the package version').toBe(false);
      },
    },

    {
      name: 'the-target-check-expects-the-same-stamp',
      async run({ expect }) {
        // Source-level: the check lives inside runTargetChecks(), which needs a
        // real project to execute. If it drifts back to the package version it
        // never matches what the generator writes, and the checks rewrite
        // database.rules.json on every single boot, the exact churn this pins.
        const source = fs.readFileSync(SETUP_SOURCE, 'utf8');
        const line = source.split('\n').find((l) => l.includes('rulesVersionRegex ='));

        expect(!!line, 'the rulesVersionRegex assignment must exist in target-checks.js').toBe(true);
        expect(line.includes('RULES_VERSION'), 'the version check must build its regex from RULES_VERSION').toBe(true);
        expect(line.includes('self.default.version'), 'the version check must not read the package version').toBe(false);
        expect(/RULES_VERSION.*require\('\.\/compile-rules'\)/.test(source), 'RULES_VERSION must come from the compiler, not a second copy').toBe(true);
      },
    },
  ],
});
