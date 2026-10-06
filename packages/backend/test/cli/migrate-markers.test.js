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
const PRE_FAMILY_GITIGNORE = [
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

      async run({ expect }) {
        const targetPath = seedTarget('omega-markers-gitignore-', { '.gitignore': PRE_FAMILY_GITIGNORE });

        await migrate(targetPath);
        const after = read(targetPath, '.gitignore');

        expect(after.includes('# BEM>>>'), 'the BEM open marker is gone').toBe(false);
        expect(after.includes('# <<<BEM'), 'the BEM close marker is gone').toBe(false);
        expect(after.includes('.firebase/'), "the block's CONTENT goes with it (BEM's own fix() semantic)").toBe(false);
        expect(after, "the consumer's own lines above the block survive").toMatch(/secrets\.local/);
        expect(after, "the consumer's own lines below the block survive").toMatch(/coverage\//);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-backend-manager-firestore-block-becomes-the-v3-seed',
      auth: 'none',

      async run({ expect }) {
        const targetPath = seedTarget('omega-markers-fs-bem-', { 'firestore.rules': preFamilyFirestore('backend-manager') });

        await migrate(targetPath);
        const after = read(targetPath, 'firestore.rules');

        expect(after.includes('///---backend-manager---///'), 'the open marker is gone').toBe(false);
        expect(after.includes('///---version=1.2.3---///'), 'the version stamp is gone').toBe(false);
        expect(after.includes('///--------tests--------///'), 'the tests divider is gone').toBe(false);
        expect(after.includes('///------resources------///'), 'the resources divider is gone').toBe(false);
        expect(after.includes('///---------end---------///'), 'the end marker is gone').toBe(false);
        expect(after.includes('belongsTo(uid)'), 'the framework-owned block is dropped, not kept').toBe(false);
        expect(after, "the brand's own rules survive").toMatch(/match \/leaderboards\/\{id\}/);
        expect(after, 'the result lands in the current seed shape').toMatch(/YOUR Firestore rules/);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-omega-interim-firestore-flavor-migrates-the-same-way',
      auth: 'none',

      async run({ expect }) {
        const targetPath = seedTarget('omega-markers-fs-omega-', { 'firestore.rules': preFamilyFirestore('omega') });

        await migrate(targetPath);
        const after = read(targetPath, 'firestore.rules');

        expect(after.includes('///---omega---///'), 'the interim open marker is gone').toBe(false);
        expect(after.includes('///---------end---------///'), 'the end marker is gone').toBe(false);
        expect(after, "the brand's own rules survive").toMatch(/match \/leaderboards\/\{id\}/);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-firestore-placeholder-becomes-the-v3-seed',
      auth: 'none',

      async run({ expect }) {
        const targetPath = seedTarget('omega-markers-fs-placeholder-', { 'firestore.rules': PLACEHOLDER_FIRESTORE });

        await migrate(targetPath);
        const after = read(targetPath, 'firestore.rules');

        expect(after.includes('backend-manager'), 'the placeholder is gone').toBe(false);
        expect(after, "the brand's own rules survive").toMatch(/match \/leaderboards\/\{id\}/);
        expect(after, 'the result lands in the current seed shape').toMatch(/YOUR Firestore rules/);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-realtime-trio-becomes-the-family-pair-carrying-its-version',
      auth: 'none',

      async run({ expect }) {
        const targetPath = seedTarget('omega-markers-db-', { 'database.rules.json': PRE_FAMILY_REALTIME });

        await migrate(targetPath);
        const after = read(targetPath, 'database.rules.json');

        expect(after, 'the open+version PAIR collapses to one family open line at the original indent, version carried').toMatch(/^ {4}\/\/ ========== OMEGA Rules \(v2\.1\.0\) ==========$/m);
        expect(after, 'the end marker becomes the family close at the original indent').toMatch(/^ {4}\/\/ ========== End OMEGA Rules ==========$/m);
        expect(after.includes('///---'), 'no pre-family marker survives').toBe(false);
        expect(after, "the block's content is preserved").toMatch(/"sessions"/);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-realtime-placeholder-becomes-the-templates-managed-block',
      auth: 'none',

      async run({ expect }) {
        const targetPath = seedTarget('omega-markers-db-placeholder-', { 'database.rules.json': PLACEHOLDER_REALTIME });

        await migrate(targetPath);
        const after = read(targetPath, 'database.rules.json');

        expect(after.includes('backend-manager'), 'the placeholder is gone').toBe(false);
        expect(after, 'the whole managed block lands at v0.0.0, so the setup checks converge the core next run').toMatch(/\/\/ ========== OMEGA Rules \(v0\.0\.0\) ==========/);
        expect(after, 'the block is closed by the family marker').toMatch(/\/\/ ========== End OMEGA Rules ==========/);
        expect(after, "the template's core rules came with it").toMatch(/"sessions"/);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-second-run-writes-nothing',
      auth: 'none',

      async run({ expect }) {
        const targetPath = seedTarget('omega-markers-twice-', {
          '.gitignore': PRE_FAMILY_GITIGNORE,
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
          expect(read(targetPath, name), `${name} is byte-identical after a second run`).toBe(first[index].contents);
          expect(jetpack.inspect(path.join(targetPath, name), { times: true }).modifyTime.getTime(), `${name} was not re-written on the second run`).toBe(first[index].mtime);
        }

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-clean-target-reports-clean-and-exits-zero',
      auth: 'none',

      async run({ expect }) {
        const targetPath = seedTarget('omega-markers-clean-', {
          '.gitignore': '# ========== Default Values ==========\nnode_modules/\n',
          'database.rules.json': jetpack.read(path.resolve(__dirname, '../../templates/database.rules.json')),
        });
        const before = read(targetPath, '.gitignore');
        const exitBefore = process.exitCode;

        await migrate(targetPath);

        expect(read(targetPath, '.gitignore'), 'a family-grammar tree is left byte-untouched').toBe(before);
        expect(process.exitCode, 'a clean target is not an error').toBe(exitBefore);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-pre-family-source-never-compiles-into-dist',
      auth: 'none',

      async run({ expect }) {
        // The placeholder flavor carries NO retired helper name, so the v2
        // hook-era path does not notice it: the check used to pass outright and
        // the compiler spliced `{{ backend-manager }}` straight into the
        // deployed artifact as if it were a brand rule.
        const targetPath = seedTarget('omega-markers-fs-nocompile-', { 'firestore.rules': PLACEHOLDER_FIRESTORE });

        const check = await runCheck(FirestoreRulesFileTest, targetPath);
        const compiled = read(targetPath, 'dist/firestore.rules') || '';

        expect(check.result === true, 'a pre-family source must never pass the check').toBe(false);
        expect(compiled.includes('backend-manager'), `${'dist/firestore.rules'} must never carry a pre-family marker, got: ${compiled.slice(0, 400)}`).toBe(false);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-firestore-check-defers-a-pre-family-source-and-is-never-auto-fixed',
      auth: 'none',

      async run({ expect }) {
        // The tree is already on the compiled model, so the #522 deferral does
        // NOT fire — this is the marker deferral's own answer. 'warn' is what
        // keeps the driver from calling fix() and scoring the check as healed.
        const source = preFamilyFirestoreNoRetiredNames('backend-manager');
        const targetPath = seedTarget('omega-markers-fs-defer-', { 'firestore.rules': source });

        const check = await runCheck(FirestoreRulesFileTest, targetPath);

        expect(check.result, 'a pre-family source DEFERS — it is not a failure the driver may auto-fix').toBe('warn');
        expect(check.fixed, 'the driver must never call fix() on a deferred check').toBe(false);
        expect(check.warning.join('\n').includes(MARKER_MIGRATION_COMMAND), `the deferral must name ${MARKER_MIGRATION_COMMAND}, got: ${check.warning.join('\n')}`).toBeTruthy();
        expect(read(targetPath, 'firestore.rules'), 'the source is byte-untouched').toBe(source);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-firestore-fix-refuses-outright-if-it-is-ever-reached',
      auth: 'none',

      async run({ expect }) {
        // Belt and braces behind the deferral: called directly, fix() must
        // still refuse rather than claim a migration it did not perform.
        const source = preFamilyFirestoreNoRetiredNames('omega');
        const targetPath = seedTarget('omega-markers-fs-refusal-', { 'firestore.rules': source });

        const output = await captureFix(FirestoreRulesFileTest, targetPath);

        expect(read(targetPath, 'firestore.rules'), 'the pre-family source is left byte-untouched — setup never converts').toBe(source);
        expect(/Migrated/.test(output), `setup must not claim a migration it did not perform, got: ${output}`).toBe(false);
        expect(output.includes(MARKER_MIGRATION_COMMAND), `the refusal must name ${MARKER_MIGRATION_COMMAND}, got: ${output}`).toBeTruthy();

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'the-realtime-check-defers-a-pre-family-file-and-is-never-auto-fixed',
      auth: 'none',

      async run({ expect }) {
        const targetPath = seedTarget('omega-markers-db-defer-', { 'database.rules.json': PRE_FAMILY_REALTIME });

        const check = await runCheck(RealtimeRulesFileTest, targetPath);

        expect(check.result, 'a pre-family realtime file DEFERS — it is not a failure the driver may auto-fix').toBe('warn');
        expect(check.fixed, 'the driver must never call fix() on a deferred check').toBe(false);
        expect(check.warning.join('\n').includes(MARKER_MIGRATION_COMMAND), `the deferral must name ${MARKER_MIGRATION_COMMAND}, got: ${check.warning.join('\n')}`).toBeTruthy();
        expect(read(targetPath, 'database.rules.json'), 'the file is byte-untouched').toBe(PRE_FAMILY_REALTIME);

        jetpack.remove(targetPath);
      },
    },

    {
      name: 'a-dollar-sequence-in-brand-rules-survives-the-splice',
      auth: 'none',

      async run({ expect }) {
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

        expect(migrated, `the brand's own text must survive byte-intact, got: ${migrated.slice(migrated.indexOf('price') - 40, migrated.indexOf('price') + 60)}`).toMatch(/\/\/ price is \$\$5, discount is \$& off/);
      },
    },

    {
      name: 'the-realtime-fix-names-the-verb-if-it-is-ever-reached',
      auth: 'none',

      async run({ expect }) {
        // Belt and braces behind the deferral, same as the firestore twin.
        const targetPath = seedTarget('omega-markers-setup-pointer-', { 'database.rules.json': PRE_FAMILY_REALTIME });

        const output = await captureFix(RealtimeRulesFileTest, targetPath);

        expect(output.includes(MARKER_MIGRATION_COMMAND), `setup must name ${MARKER_MIGRATION_COMMAND}, got: ${output}`).toBeTruthy();
        expect(read(targetPath, 'database.rules.json'), 'setup DETECTS only — it never converts').toBe(PRE_FAMILY_REALTIME);

        jetpack.remove(targetPath);
      },
    },
  ],
});
