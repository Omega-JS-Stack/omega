/**
 * Test: `omega migrate:markers` — the one-time pre-family marker conversion
 * ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
 *
 * Evergreen verbs speak ONLY the family marker grammar
 * (`<comment> ========== <Label> ==========`, see
 * _attic/plans/archive/marker-harmonization.md). A tree carried over from BEM
 * still holds one of four pre-family shapes — the `{{ backend-manager }}`
 * placeholder, the `# BEM>>>` gitignore block, the
 * `///---backend-manager---///` rules block, and the cp72-74
 * `///---omega---///` interim flavor — and nothing in the evergreen path
 * matches any of them, so the target never converges. This verb converts them
 * ONCE, run alone, and then goes quiet.
 *
 * Temp trees only — no project, no emulator.
 *
 * Run: npx omega test backend:cli/migrate-markers
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const MigrateMarkersCommand = require('../../dist/cli/commands/migrate-markers.js');
const FirestoreRulesFileTest = require('../../dist/cli/commands/setup-tests/firestore-rules-file.js');
const RealtimeRulesFileTest = require('../../dist/cli/commands/setup-tests/realtime-rules-file.js');
const { MARKER_MIGRATION_COMMAND, migratePreFamilyMarkerFile } = require('../../dist/cli/utils/compile-rules.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The BEM-era .gitignore block, byte-exact: BEM's own fix() deleted the whole
// matched block, CONTENT INCLUDED (`/# BEM>>>([\s\S]*?)# <<<BEM\n?/g`).
const BEM_GITIGNORE = [
  '# My own ignores',
  'secrets.local',
  '',
  '# BEM>>>',
  'node_modules/',
  '.firebase/',
  '# <<<BEM',
  '',
  'coverage/',
  '',
].join('\n');

/**
 * A pre-family firestore.rules: the brand's own rules above the managed block,
 * every divider present (what BEM's template actually wrote).
 * @param {string} owner - The open marker's owner (`backend-manager` or `omega`).
 * @returns {string}
 */
function preFamilyFirestore(owner) {
  return [
    'rules_version = \'2\';',
    'service cloud.firestore {',
    '  match /databases/{database}/documents {',
    '    // Custom rules',
    '    match /leaderboards/{id} {',
    '      allow read: if true;',
    '      allow write: if isAdmin();',
    '    }',
    '',
    `    ///---${owner}---///`,
    '    ///---version=1.2.3---///',
    '    match /users/{uid} {',
    '      allow read: if belongsTo(uid);',
    '      allow write: if belongsTo(uid);',
    '    }',
    '    ///--------tests--------///',
    '    // match /test-cases/write/admin {',
    '    //   allow write: if isAdmin();',
    '    // }',
    '    ///------resources------///',
    '    // https://fireship.io/snippets/firestore-rules-recipes/',
    '    ///---------end---------///',
    '',
    '  }',
    '}',
    '',
  ].join('\n');
}

/**
 * The same block flavor with NO retired helper name anywhere in it. A guard
 * asserted against `preFamilyFirestore()` can pass for the WRONG reason: its
 * `belongsTo(uid)` alone trips the v2 hook-era path, so the check would notice
 * the file even with no pre-family guard at all. Here only the MARKERS are
 * noticeable.
 * @param {string} owner - The open marker's owner.
 * @returns {string}
 */
function preFamilyFirestoreNoRetiredNames(owner) {
  return [
    'rules_version = \'2\';',
    'service cloud.firestore {',
    '  match /databases/{database}/documents {',
    '    match /leaderboards/{id} {',
    '      allow read: if true;',
    '    }',
    '',
    `    ///---${owner}---///`,
    '    ///---version=1.2.3---///',
    '    match /users/{uid} {',
    '      allow read: if isUser(uid);',
    '    }',
    '    ///---------end---------///',
    '  }',
    '}',
    '',
  ].join('\n');
}

// The hand-written placeholder flavor: whitespace-tolerant, and the ONLY thing
// marking where the managed block belongs.
const PLACEHOLDER_FIRESTORE = [
  'rules_version = \'2\';',
  'service cloud.firestore {',
  '  match /databases/{database}/documents {',
  '    match /leaderboards/{id} {',
  '      allow read: if true;',
  '    }',
  '',
  '    {{ backend-manager }}',
  '  }',
  '}',
  '',
].join('\n');

// database.rules.json's flavor of format 3/4: open + version + end only (it
// never carried the tests/resources dividers).
const PRE_FAMILY_REALTIME = [
  '{',
  '  "rules": {',
  '    ///---omega---///',
  '    ///---version=2.1.0---///',
  '',
  '    "sessions": {',
  '      ".read": false,',
  '      ".write": false',
  '    },',
  '    ///---------end---------///',
  '  }',
  '}',
  '',
].join('\n');

const PLACEHOLDER_REALTIME = [
  '{',
  '  "rules": {',
  '    {{ backend-manager }}',
  '  }',
  '}',
  '',
].join('\n');

/**
 * A backend target root carrying whatever files the case needs.
 * @param {string} prefix - Temp dir prefix.
 * @param {object} files - Relative path → contents.
 * @returns {string} The target root.
 */
function seedTarget(prefix, files) {
  const targetPath = jetpack.tmpDir({ prefix: prefix }).path();

  jetpack.write(path.join(targetPath, 'firebase.json'), JSON.stringify({ firestore: { rules: 'dist/firestore.rules' } }, null, 2));

  for (const [name, contents] of Object.entries(files)) {
    jetpack.write(path.join(targetPath, name), contents);
  }

  return targetPath;
}

/** Run the verb against a target root, exactly as the dispatcher does. */
async function migrate(targetPath) {
  const command = new MigrateMarkersCommand({ firebaseProjectPath: targetPath, argv: {}, options: {} });
  await command.execute();
}

/** Read a target file. */
function read(targetPath, name) {
  return jetpack.read(path.join(targetPath, name));
}

/**
 * Run a setup check exactly as the real driver does (src/cli/index.js): run(),
 * and auto-fix ONLY what came back neither true nor 'warn'. A check that defers
 * ('warn') is reported and its fix() is never called — which is the difference
 * between a deferral and a check that quietly "fixed" itself.
 * @param {Function} TestClass - The setup-test class.
 * @param {string} targetPath - The target root.
 * @returns {Promise<{result: *, warning: string[], fixed: boolean}>}
 */
async function runCheck(TestClass, targetPath) {
  const main = {
    firebaseProjectPath: targetPath,
    firebaseJSON: jetpack.read(path.join(targetPath, 'firebase.json'), 'json'),
    argv: {},
    default: {},
  };
  const check = new TestClass({ main: main });
  const result = await check.run();
  let fixed = false;

  if (result !== true && result !== 'warn') {
    await check.fix();
    fixed = true;
  }

  return { result: result, warning: check.getWarning(), fixed: fixed };
}

/** Run a check's fix() directly, with its console output captured. */
async function captureFix(TestClass, targetPath) {
  const check = new TestClass({ main: {
    firebaseProjectPath: targetPath,
    firebaseJSON: jetpack.read(path.join(targetPath, 'firebase.json'), 'json'),
    argv: {},
    default: {},
  } });
  const lines = [];
  const original = console.log;

  console.log = (...args) => lines.push(args.join(' '));
  try {
    await check.fix();
  } finally {
    console.log = original;
  }

  return lines.join('\n');
}

module.exports = defineCases({
  description: 'migrate:markers — pre-family markers converted ONCE, then quiet',
  type: 'group',

  tests: [
    {
      name: 'the-bem-gitignore-block-is-deleted-content-included',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-markers-gitignore-', { '.gitignore': BEM_GITIGNORE });

        await migrate(targetPath);
        const after = read(targetPath, '.gitignore');

        assert.equal(after.includes('# BEM>>>'), false, 'the BEM open marker is gone');
        assert.equal(after.includes('# <<<BEM'), false, 'the BEM close marker is gone');
        assert.equal(after.includes('.firebase/'), false, "the block's CONTENT goes with it (BEM's own fix() semantic)");
        assert.match(after, /secrets\.local/, "the consumer's own lines above the block survive");
        assert.match(after, /coverage\//, "the consumer's own lines below the block survive");

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-backend-manager-firestore-block-becomes-the-v3-seed',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-markers-fs-bem-', { 'firestore.rules': preFamilyFirestore('backend-manager') });

        await migrate(targetPath);
        const after = read(targetPath, 'firestore.rules');

        assert.equal(after.includes('///---backend-manager---///'), false, 'the open marker is gone');
        assert.equal(after.includes('///---version=1.2.3---///'), false, 'the version stamp is gone');
        assert.equal(after.includes('///--------tests--------///'), false, 'the tests divider is gone');
        assert.equal(after.includes('///------resources------///'), false, 'the resources divider is gone');
        assert.equal(after.includes('///---------end---------///'), false, 'the end marker is gone');
        assert.equal(after.includes('belongsTo(uid)'), false, 'the framework-owned block is dropped, not kept');
        assert.match(after, /match \/leaderboards\/\{id\}/, "the brand's own rules survive");
        assert.match(after, /YOUR Firestore rules/, 'the result lands in the current seed shape');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-omega-interim-firestore-flavor-migrates-the-same-way',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-markers-fs-omega-', { 'firestore.rules': preFamilyFirestore('omega') });

        await migrate(targetPath);
        const after = read(targetPath, 'firestore.rules');

        assert.equal(after.includes('///---omega---///'), false, 'the interim open marker is gone');
        assert.equal(after.includes('///---------end---------///'), false, 'the end marker is gone');
        assert.match(after, /match \/leaderboards\/\{id\}/, "the brand's own rules survive");

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-firestore-placeholder-becomes-the-v3-seed',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-markers-fs-placeholder-', { 'firestore.rules': PLACEHOLDER_FIRESTORE });

        await migrate(targetPath);
        const after = read(targetPath, 'firestore.rules');

        assert.equal(after.includes('backend-manager'), false, 'the placeholder is gone');
        assert.match(after, /match \/leaderboards\/\{id\}/, "the brand's own rules survive");
        assert.match(after, /YOUR Firestore rules/, 'the result lands in the current seed shape');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-realtime-trio-becomes-the-family-pair-carrying-its-version',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-markers-db-', { 'database.rules.json': PRE_FAMILY_REALTIME });

        await migrate(targetPath);
        const after = read(targetPath, 'database.rules.json');

        assert.match(after, /^ {4}\/\/ ========== OMEGA Rules \(v2\.1\.0\) ==========$/m, 'the open+version PAIR collapses to one family open line at the original indent, version carried');
        assert.match(after, /^ {4}\/\/ ========== End OMEGA Rules ==========$/m, 'the end marker becomes the family close at the original indent');
        assert.equal(after.includes('///---'), false, 'no pre-family marker survives');
        assert.match(after, /"sessions"/, "the block's content is preserved");

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-realtime-placeholder-becomes-the-templates-managed-block',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-markers-db-placeholder-', { 'database.rules.json': PLACEHOLDER_REALTIME });

        await migrate(targetPath);
        const after = read(targetPath, 'database.rules.json');

        assert.equal(after.includes('backend-manager'), false, 'the placeholder is gone');
        assert.match(after, /\/\/ ========== OMEGA Rules \(v0\.0\.0\) ==========/, 'the whole managed block lands at v0.0.0, so the setup checks converge the core next run');
        assert.match(after, /\/\/ ========== End OMEGA Rules ==========/, 'the block is closed by the family marker');
        assert.match(after, /"sessions"/, "the template's core rules came with it");

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-second-run-writes-nothing',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-markers-twice-', {
          '.gitignore': BEM_GITIGNORE,
          'firestore.rules': preFamilyFirestore('backend-manager'),
          'database.rules.json': PRE_FAMILY_REALTIME,
        });
        const names = ['.gitignore', 'firestore.rules', 'database.rules.json'];

        await migrate(targetPath);
        const first = names.map((name) => ({
          contents: read(targetPath, name),
          mtime: jetpack.inspect(path.join(targetPath, name), { times: true }).modifyTime.getTime(),
        }));

        await migrate(targetPath);

        for (const [index, name] of names.entries()) {
          assert.equal(read(targetPath, name), first[index].contents, `${name} is byte-identical after a second run`);
          assert.equal(jetpack.inspect(path.join(targetPath, name), { times: true }).modifyTime.getTime(), first[index].mtime, `${name} was not re-written on the second run`);
        }

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-clean-target-reports-clean-and-exits-zero',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-markers-clean-', {
          '.gitignore': '# ========== Default Values ==========\nnode_modules/\n',
          'database.rules.json': jetpack.read(path.resolve(__dirname, '../../templates/database.rules.json')),
        });
        const before = read(targetPath, '.gitignore');
        const exitBefore = process.exitCode;

        await migrate(targetPath);

        assert.equal(read(targetPath, '.gitignore'), before, 'a family-grammar tree is left byte-untouched');
        assert.equal(process.exitCode, exitBefore, 'a clean target is not an error');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-pre-family-source-never-compiles-into-dist',
      auth: 'none',

      async run({ assert }) {
        // The placeholder flavor carries NO retired helper name, so the v2
        // hook-era path does not notice it: the check used to pass outright and
        // the compiler spliced `{{ backend-manager }}` straight into the
        // deployed artifact as if it were a brand rule.
        const targetPath = seedTarget('omega-markers-fs-nocompile-', { 'firestore.rules': PLACEHOLDER_FIRESTORE });

        const check = await runCheck(FirestoreRulesFileTest, targetPath);
        const compiled = read(targetPath, 'dist/firestore.rules') || '';

        assert.equal(check.result === true, false, 'a pre-family source must never pass the check');
        assert.equal(compiled.includes('backend-manager'), false, `${'dist/firestore.rules'} must never carry a pre-family marker, got: ${compiled.slice(0, 400)}`);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-firestore-check-defers-a-pre-family-source-and-is-never-auto-fixed',
      auth: 'none',

      async run({ assert }) {
        // The tree is already on the compiled model, so the #522 deferral does
        // NOT fire — this is the marker deferral's own answer. 'warn' is what
        // keeps the driver from calling fix() and scoring the check as healed.
        const source = preFamilyFirestoreNoRetiredNames('backend-manager');
        const targetPath = seedTarget('omega-markers-fs-defer-', { 'firestore.rules': source });

        const check = await runCheck(FirestoreRulesFileTest, targetPath);

        assert.equal(check.result, 'warn', 'a pre-family source DEFERS — it is not a failure the driver may auto-fix');
        assert.equal(check.fixed, false, 'the driver must never call fix() on a deferred check');
        assert.ok(check.warning.join('\n').includes(MARKER_MIGRATION_COMMAND), `the deferral must name ${MARKER_MIGRATION_COMMAND}, got: ${check.warning.join('\n')}`);
        assert.equal(read(targetPath, 'firestore.rules'), source, 'the source is byte-untouched');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-firestore-fix-refuses-outright-if-it-is-ever-reached',
      auth: 'none',

      async run({ assert }) {
        // Belt and braces behind the deferral: called directly, fix() must
        // still refuse rather than claim a migration it did not perform.
        const source = preFamilyFirestoreNoRetiredNames('omega');
        const targetPath = seedTarget('omega-markers-fs-refusal-', { 'firestore.rules': source });

        const output = await captureFix(FirestoreRulesFileTest, targetPath);

        assert.equal(read(targetPath, 'firestore.rules'), source, 'the pre-family source is left byte-untouched — setup never converts');
        assert.equal(/Migrated/.test(output), false, `setup must not claim a migration it did not perform, got: ${output}`);
        assert.ok(output.includes(MARKER_MIGRATION_COMMAND), `the refusal must name ${MARKER_MIGRATION_COMMAND}, got: ${output}`);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-realtime-check-defers-a-pre-family-file-and-is-never-auto-fixed',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget('omega-markers-db-defer-', { 'database.rules.json': PRE_FAMILY_REALTIME });

        const check = await runCheck(RealtimeRulesFileTest, targetPath);

        assert.equal(check.result, 'warn', 'a pre-family realtime file DEFERS — it is not a failure the driver may auto-fix');
        assert.equal(check.fixed, false, 'the driver must never call fix() on a deferred check');
        assert.ok(check.warning.join('\n').includes(MARKER_MIGRATION_COMMAND), `the deferral must name ${MARKER_MIGRATION_COMMAND}, got: ${check.warning.join('\n')}`);
        assert.equal(read(targetPath, 'database.rules.json'), PRE_FAMILY_REALTIME, 'the file is byte-untouched');

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-dollar-sequence-in-brand-rules-survives-the-splice',
      auth: 'none',

      async run({ assert }) {
        // `$$`, `$&`, `` $` `` and `$'` are replacement-string directives: fed
        // to String.replace as the REPLACEMENT, a brand's own text gets rewritten
        // on its way into the seed.
        const source = [
          'rules_version = \'2\';',
          'service cloud.firestore {',
          '  match /databases/{database}/documents {',
          '    // price is $$5, discount is $& off',
          '    match /prices/{id} {',
          '      allow read: if true;',
          '    }',
          '',
          '    {{ backend-manager }}',
          '  }',
          '}',
          '',
        ].join('\n');

        const migrated = migratePreFamilyMarkerFile(source);

        assert.match(migrated, /\/\/ price is \$\$5, discount is \$& off/, `the brand's own text must survive byte-intact, got: ${migrated.slice(migrated.indexOf('price') - 40, migrated.indexOf('price') + 60)}`);
      },
    },

    {
      name: 'the-realtime-fix-names-the-verb-if-it-is-ever-reached',
      auth: 'none',

      async run({ assert }) {
        // Belt and braces behind the deferral, same as the firestore twin.
        const targetPath = seedTarget('omega-markers-setup-pointer-', { 'database.rules.json': PRE_FAMILY_REALTIME });

        const output = await captureFix(RealtimeRulesFileTest, targetPath);

        assert.ok(output.includes(MARKER_MIGRATION_COMMAND), `setup must name ${MARKER_MIGRATION_COMMAND}, got: ${output}`);
        assert.equal(read(targetPath, 'database.rules.json'), PRE_FAMILY_REALTIME, 'setup DETECTS only — it never converts');

        jetpack.remove(targetPath);
      },
    },
  ],
});
