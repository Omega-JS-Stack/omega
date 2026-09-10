/**
 * Test: the compiled-rules migration is deferred, never a setup side effect
 * ([#522](https://github.com/Omega-JS-Stack/omega/issues/522)).
 *
 * A brand carrying legacy-exact rules (`firestore.rules` at the target root,
 * `firebase.json` pointing at it) has DEFERRED the compiled-rules migration.
 * `omega setup` auto-fixes every failing check with no prompt, so the two rules
 * checks used to rewrite the brand's source in place and repoint firebase.json
 * at `dist/firestore.rules` — and the compiled artifact carries the CURRENT
 * framework posture, which differs behaviorally from legacy (`allow write`
 * becomes `allow create, update`, so a client deleting its own user doc flips
 * allowed → denied on the live project). Nothing goes red first: the deploy
 * chain is `omega setup && omega deploy`.
 *
 * Per the 2026-08-21 ruling (no silent healing; one-time migrations are loud,
 * deliberate, run-alone) both checks now DEFER, and `omega migrate:rules` is
 * the run-alone step that actually migrates.
 *
 * Temp trees only — no project, no emulator.
 *
 * Run: npx omega test backend:cli/rules-migration-deferral
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const FirestoreRulesFileTest = require('../../dist/cli/commands/setup-tests/firestore-rules-file.js');
const FirestoreRulesInJsonTest = require('../../dist/cli/commands/setup-tests/firestore-rules-in-json.js');
const MigrateRulesCommand = require('../../dist/cli/commands/migrate-rules.js');
const {
  BRAND_RULES_FILE,
  BRAND_RULES_SEED,
  COMPILED_RULES_FILE,
  RULES_MIGRATION_COMMAND,
  compileFirestoreRules,
} = require('../../dist/cli/utils/compile-rules.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A pre-#255 consumer file: the brand's own rules above the managed block —
// the exact shape operst and playlisteer still carry.
const LEGACY_SOURCE = [
  'rules_version = \'2\';',
  'service cloud.firestore {',
  '  match /databases/{database}/documents {',
  '    // Custom rules',
  '    match /leaderboards/{id} {',
  '      allow read: if true;',
  '      allow write: if isAdmin();',
  '    }',
  '',
  '    // ========== OMEGA Rules (v1.0.0) ==========',
  '    match /users/{uid} {',
  '      allow read: if belongsTo(uid);',
  '      allow write: if belongsTo(uid);',
  '    }',
  '    // ========== End OMEGA Rules ==========',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A target root carrying a rules source and a firebase.json naming a target.
 * @param {string} prefix - Temp dir prefix.
 * @param {string} source - The brand's firestore.rules contents.
 * @param {string} rulesTarget - What firebase.json points firestore.rules at.
 * @returns {string} The target root.
 */
function seedTarget(prefix, source, rulesTarget) {
  const targetPath = jetpack.tmpDir({ prefix: prefix }).path();

  jetpack.write(path.join(targetPath, BRAND_RULES_FILE), source);
  jetpack.write(path.join(targetPath, 'firebase.json'), JSON.stringify({ firestore: { rules: rulesTarget } }, null, 2));

  return targetPath;
}

/** Both authored files, as bytes — the migration's blast radius. */
function snapshot(targetPath) {
  return {
    rules: jetpack.read(path.join(targetPath, BRAND_RULES_FILE)),
    firebaseJSON: jetpack.read(path.join(targetPath, 'firebase.json')),
  };
}

/**
 * Run a setup check exactly as `omega setup` does: run(), and auto-fix
 * anything that came back falsy ('warn' is reported, never fixed).
 * @param {Function} TestClass - The setup-test class.
 * @param {string} targetPath - The target root.
 * @returns {Promise<{result: *, warning: string[]}>}
 */
async function runCheck(TestClass, targetPath) {
  const main = {
    firebaseProjectPath: targetPath,
    firebaseJSON: jetpack.read(path.join(targetPath, 'firebase.json'), 'json'),
    argv: {},
  };
  const check = new TestClass({ main: main });
  const result = await check.run();

  if (result !== true && result !== 'warn') {
    await check.fix();
  }

  return { result: result, warning: check.getWarning() };
}

module.exports = defineCases({
  description: 'compiled-rules migration deferral (no silent healing)',
  type: 'group',

  tests: [
    {
      name: 'setup-leaves-a-legacy-exact-tree-byte-identical',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-rules-defer-', LEGACY_SOURCE, BRAND_RULES_FILE);
        const before = snapshot(targetPath);

        const inJson = await runCheck(FirestoreRulesInJsonTest, targetPath);
        const file = await runCheck(FirestoreRulesFileTest, targetPath);
        const after = snapshot(targetPath);

        assert.equal(inJson.result, 'warn', 'the firebase.json check must DEFER, not fail into a fix');
        assert.equal(file.result, 'warn', 'the rules-source check must DEFER, not fail into a fix');
        assert.equal(after.rules, before.rules, `${BRAND_RULES_FILE} must be byte-identical after setup`);
        assert.equal(after.firebaseJSON, before.firebaseJSON, 'firebase.json must be byte-identical after setup');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-deferral-is-named-in-the-output-with-the-migration-pointer',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-rules-defer-notice-', LEGACY_SOURCE, BRAND_RULES_FILE);

        const inJson = await runCheck(FirestoreRulesInJsonTest, targetPath);
        const file = await runCheck(FirestoreRulesFileTest, targetPath);

        const jsonNotice = inJson.warning.join('\n');
        const fileNotice = file.warning.join('\n');

        assert.match(jsonNotice, /defer/i, 'the firebase.json deferral must say it deferred');
        assert.match(jsonNotice, /live posture|allow create, update/i, 'the deferral must name what migrating would change');
        assert.ok(jsonNotice.includes(RULES_MIGRATION_COMMAND), `the deferral must point at ${RULES_MIGRATION_COMMAND}`);
        assert.ok(fileNotice.includes(RULES_MIGRATION_COMMAND), `the rules-source deferral must point at ${RULES_MIGRATION_COMMAND}`);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-tree-already-on-the-compiled-artifact-still-migrates-and-compiles',
      auth: 'none',

      async run({ assert }) {
        // Deferral hangs on the firebase.json TARGET, not on the source's era:
        // a brand already deploying dist/firestore.rules has taken the model,
        // so setup keeps healing its source exactly as before.
        const targetPath = seedTarget('omega-rules-nodefer-', LEGACY_SOURCE, COMPILED_RULES_FILE);

        const file = await runCheck(FirestoreRulesFileTest, targetPath);

        assert.equal(file.result, false, 'an unmigrated source under the compiled target still fails into its fix');
        assert.equal(jetpack.read(path.join(targetPath, BRAND_RULES_FILE)).includes('OMEGA Rules (v1.0.0)'), false, 'the marker block is migrated out');
        assert.equal(jetpack.exists(path.join(targetPath, COMPILED_RULES_FILE)), 'file', 'the compiled artifact is written');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-fresh-tree-is-untouched-by-the-deferral',
      auth: 'none',

      async run({ assert }) {
        // No rules file and no firestore target — nothing has been deferred,
        // so the seed + retarget path must still run for a new brand.
        const targetPath = jetpack.tmpDir({ prefix: 'omega-rules-fresh-' }).path();
        jetpack.write(path.join(targetPath, 'firebase.json'), JSON.stringify({}, null, 2));

        const inJson = await runCheck(FirestoreRulesInJsonTest, targetPath);
        const file = await runCheck(FirestoreRulesFileTest, targetPath);

        assert.equal(inJson.result, false, 'a fresh tree fails the check and takes the fix');
        assert.equal(file.result, false, 'a fresh tree fails the check and takes the fix');
        assert.equal(jetpack.read(path.join(targetPath, 'firebase.json'), 'json').firestore.rules, COMPILED_RULES_FILE, 'firebase.json is pointed at the compiled artifact');
        assert.equal(jetpack.read(path.join(targetPath, BRAND_RULES_FILE)), jetpack.read(BRAND_RULES_SEED), 'the brand source is seeded');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-migration-verb-does-what-setup-refused-to',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-rules-verb-', LEGACY_SOURCE, BRAND_RULES_FILE);

        const command = new MigrateRulesCommand({ firebaseProjectPath: targetPath, argv: {}, options: {} });
        await command.execute();

        const source = jetpack.read(path.join(targetPath, BRAND_RULES_FILE));

        assert.equal(source.includes('OMEGA Rules (v1.0.0)'), false, 'the marker block is migrated out of the brand source');
        assert.match(source, /match \/leaderboards\/\{id\}/, "the brand's own rules survive the migration");
        assert.equal(jetpack.read(path.join(targetPath, 'firebase.json'), 'json').firestore.rules, COMPILED_RULES_FILE, 'firebase.json is repointed at the compiled artifact');
        assert.equal(jetpack.exists(path.join(targetPath, COMPILED_RULES_FILE)), 'file', 'the compiled artifact is written');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-migration-verb-is-idempotent',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-rules-verb-twice-', LEGACY_SOURCE, BRAND_RULES_FILE);
        const command = new MigrateRulesCommand({ firebaseProjectPath: targetPath, argv: {}, options: {} });

        await command.execute();
        const first = snapshot(targetPath);

        await command.execute();
        const second = snapshot(targetPath);

        assert.equal(second.rules, first.rules, 'a second run leaves the brand source alone');
        assert.equal(second.firebaseJSON, first.firebaseJSON, 'a second run leaves firebase.json alone');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-compiler-points-a-deferred-tree-at-the-migration-verb',
      auth: 'none',

      async run({ assert }) {
        // The build's stale-target warning used to say `npx omega setup` — the
        // one command that will no longer do it.
        const targetPath = seedTarget('omega-rules-warn-', jetpack.read(BRAND_RULES_SEED), BRAND_RULES_FILE);
        const warnings = [];

        compileFirestoreRules({ projectDir: targetPath, onWarn: (message) => warnings.push(message) });

        assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`);
        assert.ok(warnings[0].includes(RULES_MIGRATION_COMMAND), `the warning must point at ${RULES_MIGRATION_COMMAND}, not at setup`);

        jetpack.remove(targetPath);
      },
    },
  ],
});
