/**
 * Test: the compiled Firestore rules model
 * ([#255](https://github.com/Omega-JS-Stack/omega/issues/255),
 * [#288](https://github.com/Omega-JS-Stack/omega/issues/288)).
 *
 * The brand's `firestore.rules` is SOURCE (its own rules plus two hook
 * functions); the framework half ships inside this package; every stage
 * compiles the two into `dist/firestore.rules`, which firebase.json points the
 * emulator AND `firebase deploy` at.
 *
 * Everything here is string work against temp dirs — no project, no emulator.
 * The rules SEMANTICS the hooks buy (a brand's `protectedFields()` actually
 * denying a client write) are proven against the real emulator in
 * test/rules/user-protected-fields.test.js.
 *
 * Run: npx omega test backend:cli/rules-compile
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const {
  BRAND_HOOKS,
  BRAND_RULES_SEED,
  COMPILED_RULES_FILE,
  RULES_VERSION,
  compileRules,
  compileFirestoreRules,
  ensureBrandRulesSource,
  extractDocumentsBody,
} = require('../../src/cli/utils/compile-rules.js');
const { stageFunctions } = require('../../src/cli/utils/stage-functions.js');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'firebase-project');

// A brand source with no hooks at all — what the lint has to catch.
const HOOKLESS_SOURCE = [
  'rules_version = \'2\';',
  'service cloud.firestore {',
  '  match /databases/{database}/documents {',
  '    match /posts/{id} {',
  '      allow read: if true;',
  '    }',
  '  }',
  '}',
  '',
].join('\n');

// A pre-#255 consumer file: the brand's own rules above the managed block.
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
  '      allow write: if belongsTo(uid) && !isWritingProtectedUserField();',
  '    }',
  '    // ========== End OMEGA Rules ==========',
  '  }',
  '}',
  '',
].join('\n');

function seedApp(prefix, brandSource) {
  const appPath = jetpack.tmpDir({ prefix }).path();

  jetpack.write(path.join(appPath, 'package.json'), JSON.stringify({ name: 'rules-compile-app', dependencies: {} }, null, 2));
  jetpack.write(path.join(appPath, 'src', 'index.js'), '// entry\n');
  jetpack.write(path.join(appPath, 'config', 'omega.json5'), JSON.stringify({
    brand: { name: 'Rules Compile', url: 'https://rules-compile.test' },
    cloud: { config: { projectId: 'demo-rules-compile' } },
    targets: { backend: {} },
  }, null, 2));
  jetpack.write(path.join(appPath, 'firebase.json'), JSON.stringify({ firestore: { rules: COMPILED_RULES_FILE } }, null, 2));

  if (brandSource) {
    jetpack.write(path.join(appPath, 'firestore.rules'), brandSource);
  }

  return appPath;
}

function compileSeed() {
  return compileRules({ brandSource: jetpack.read(BRAND_RULES_SEED) }).compiled;
}

module.exports = {
  description: 'Compiled Firestore rules: two sources, one artifact, linted hooks',
  type: 'group',
  timeout: 20000,

  tests: [
    // The header is the whole clarity requirement: a reader who opens the
    // generated file must learn, without leaving it, that it is generated and
    // WHICH two files to edit instead.
    {
      name: 'compiled-header-names-both-sources-and-forbids-editing',
      auth: 'none',

      async run({ assert }) {
        const header = compileSeed().split('rules_version')[0];

        assert.match(header, /GENERATED FILE — DO NOT EDIT/, 'the artifact must say it is generated');
        assert.match(header, /\.\/firestore\.rules/, 'the header must name the BRAND source');
        assert.match(header, /EDIT THAT FILE/, 'the header must say which file to edit instead');
        assert.match(header, /node_modules\/@omega\.js\/backend\/templates\/firestore\.framework\.rules/, 'the header must name the framework half by its install path');
        assert.match(header, new RegExp(`rules schema v${RULES_VERSION.replace(/\./g, '\\.')}`), 'the header must stamp the rules schema version');
      },
    },

    // One scope, or the halves cannot call each other's functions: Firestore
    // resolves functions within a match block, and ORs `allow` across sibling
    // blocks (the whole reason #255 exists).
    {
      name: 'both-halves-share-one-documents-scope',
      auth: 'none',

      async run({ assert }) {
        const compiled = compileSeed();
        const body = extractDocumentsBody(compiled, 'compiled');

        assert.equal(compiled.match(/rules_version/g).length, 1, 'exactly one rules_version declaration');
        assert.equal(compiled.match(/service cloud\.firestore/g).length, 1, 'exactly one service block');
        assert.equal((compiled.match(/match \/databases\/\{database\}\/documents/g) || []).length, 1, 'exactly one documents match block');

        for (const hook of BRAND_HOOKS) {
          assert.match(body, new RegExp(`function ${hook}\\(`), `the brand hook ${hook}() must land in the shared scope`);
        }
        assert.match(body, /function belongsTo\(identity\)/, 'the framework helpers must land in the same scope');
      },
    },

    // The hook contract itself (#255): the write rule ANDs both hooks, and the
    // brand list folds in through affectedKeys().hasAny().
    {
      name: 'user-write-rule-ands-both-brand-hooks',
      auth: 'none',

      async run({ assert }) {
        const compiled = compileSeed();

        assert.match(
          compiled,
          /allow write: if belongsTo\(uid\) && !isWritingProtectedUserField\(\) && canWriteUser\(\);/,
          'the user-doc write rule must AND both brand hooks',
        );
        assert.match(
          compiled,
          /incomingData\(\)\.diff\(existingData\(\)\)\.affectedKeys\(\)\.hasAny\(protectedFields\(\)\)/,
          'isWritingProtectedUserField() must fold the brand list in',
        );
        assert.match(compiled, /function protectedFields\(\) \{\s*\n\s*return \[\];/, 'the seeded default must be an empty list');
        assert.match(compiled, /function canWriteUser\(\) \{\s*\n\s*return true;/, 'the seeded default must be true');
      },
    },

    // #288: the malformed-doc guard legacy BEM had and the managed block lost.
    {
      name: 'notifications-update-requires-token-to-equal-the-doc-id',
      auth: 'none',

      async run({ assert }) {
        const compiled = compileSeed();
        const block = compiled.split('match /notifications/{token} {')[1].split('    }')[0];
        const update = block.split('allow update:')[1];

        assert.match(update, /incomingData\(\)\.token == token/, 'update must require the incoming token to equal the doc id');
        assert.match(update, /incomingData\(\)\.token == existingData\(\)\.token/, 'update must keep the token immutable');
        assert.match(block, /allow get: if true;/, 'get: if true stays by design (token-as-capability)');
      },
    },

    // A missing hook cannot be allowed to produce a ruleset that fails to
    // compile — the artifact gets the default, and the caller is told.
    {
      name: 'missing-hook-is-reseeded-into-the-artifact-and-reported',
      auth: 'none',

      async run({ assert }) {
        const { compiled, reseeded } = compileRules({ brandSource: HOOKLESS_SOURCE });

        assert.deepEqual(reseeded, BRAND_HOOKS, 'every missing hook must be reported');
        for (const hook of BRAND_HOOKS) {
          assert.match(compiled, new RegExp(`function ${hook}\\(`), `${hook}() must be re-seeded into the artifact`);
        }
        assert.match(compiled, /Hooks re-seeded by the compiler/, 'the artifact must mark what it re-seeded');
      },
    },

    // …and setup writes the stub back into the brand's own file, loudly, so
    // the brand ends up owning it.
    {
      name: 'missing-hook-is-written-back-into-the-brand-source',
      auth: 'none',

      async run({ assert }) {
        const appPath = seedApp('omega-rules-hooks-', HOOKLESS_SOURCE);
        const warnings = [];

        const result = ensureBrandRulesSource({ projectDir: appPath });
        const repaired = jetpack.read(path.join(appPath, 'firestore.rules'));

        assert.deepEqual(result.reseeded, BRAND_HOOKS, 'both hooks must be reported as re-seeded');
        assert.match(repaired, /match \/posts\/\{id\}/, 'the brand\'s own rules must survive the repair');
        for (const hook of BRAND_HOOKS) {
          assert.match(repaired, new RegExp(`function ${hook}\\(`), `${hook}() must be written back into the source`);
        }

        // Idempotent: a second pass has nothing left to do.
        assert.deepEqual(ensureBrandRulesSource({ projectDir: appPath }).reseeded, [], 'the repair must not repeat');

        // And the compiler reports the same thing loudly to whoever built.
        compileFirestoreRules({ projectDir: seedApp('omega-rules-hooks-warn-', HOOKLESS_SOURCE), onWarn: (m) => warnings.push(m) });
        assert.equal(warnings.filter((m) => m.includes('protectedFields()')).length, 1, 'the build must report the missing hook loudly');
      },
    },

    // Migration: a pre-#255 file converts ONCE, custom region intact, markers
    // gone, hooks seeded.
    {
      name: 'legacy-marker-file-migrates-once-and-keeps-the-custom-region',
      auth: 'none',

      async run({ assert }) {
        const appPath = seedApp('omega-rules-legacy-', LEGACY_SOURCE);

        const first = ensureBrandRulesSource({ projectDir: appPath });
        const migrated = jetpack.read(path.join(appPath, 'firestore.rules'));

        assert.equal(first.migrated, true, 'the legacy marker block must be detected');
        assert.match(migrated, /match \/leaderboards\/\{id\}/, 'the brand\'s custom region must be preserved');
        assert.equal(migrated.includes('OMEGA Rules (v'), false, 'the managed marker block must be gone');
        assert.equal(migrated.includes('End OMEGA Rules'), false, 'the closing marker must be gone too');
        for (const hook of BRAND_HOOKS) {
          assert.match(migrated, new RegExp(`function ${hook}\\(`), `${hook}() must be seeded by the migration`);
        }

        const second = ensureBrandRulesSource({ projectDir: appPath });
        assert.equal(second.migrated, false, 'migration must run once');
        assert.equal(jetpack.read(path.join(appPath, 'firestore.rules')), migrated, 'a second setup must not touch the file');

        // The migrated file still compiles, and the framework half comes back.
        const compiled = compileRules({ brandSource: migrated }).compiled;
        assert.match(compiled, /match \/leaderboards\/\{id\}/, 'the compiled artifact carries the brand rules');
        assert.match(compiled, /match \/notifications\/\{token\}/, 'the compiled artifact carries the framework rules');
      },
    },

    // …and until that migration runs, the compile REFUSES. A marker file still
    // carries the framework's own functions, so splicing it into the framework
    // half emits every one of them twice — a ruleset Firestore will not load.
    {
      name: 'a-legacy-marker-source-is-refused-instead-of-compiled',
      auth: 'none',

      async run({ assert }) {
        const appPath = seedApp('omega-rules-refuse-', LEGACY_SOURCE);
        const warnings = [];

        const result = compileFirestoreRules({ projectDir: appPath, onWarn: (message) => warnings.push(message) });

        assert.equal(result.refused, true, 'the build must report the refusal');
        assert.equal(jetpack.exists(path.join(appPath, COMPILED_RULES_FILE)), false, 'an unmigrated source must leave no artifact behind');
        assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`);
        assert.match(warnings[0], /legacy OMEGA Rules marker block/, 'the refusal must name what it found');
        assert.match(warnings[0], /npx omega setup/, 'the refusal must name the migration');

        // The pure compile refuses at the break point too, so no other caller
        // can talk it into the duplicate-function artifact.
        let threw = null;
        try {
          compileRules({ brandSource: LEGACY_SOURCE });
        } catch (error) {
          threw = error;
        }

        assert.ok(threw, 'compiling an unmigrated source must throw');
        assert.match(threw.message, /npx omega setup/, 'the error must name the migration');

        // The STAGE only reports it, because setup stages before its checks
        // run — a throw here would kill the very run that migrates the file.
        const { staged } = stageFunctions({ projectDir: appPath });

        assert.equal(staged.some((step) => step.includes('firestore.rules')), false, 'the stage must not claim a compile it refused');
        assert.equal(jetpack.exists(path.join(appPath, COMPILED_RULES_FILE)), false, 'and it must still leave no artifact');
      },
    },

    // The build step: every stage rebuilds the artifact, because the stage
    // wipes dist/ and firebase.json points at what is left behind.
    {
      name: 'every-stage-recompiles-the-artifact-from-the-brand-source',
      auth: 'none',

      async run({ assert }) {
        const appPath = seedApp('omega-rules-stage-', jetpack.read(BRAND_RULES_SEED));
        const artifact = path.join(appPath, COMPILED_RULES_FILE);

        const { staged } = stageFunctions({ projectDir: appPath });
        assert.equal(staged.some((step) => step.includes('firestore.rules')), true, 'the stage must report the compile step');
        assert.equal(jetpack.exists(artifact), 'file', 'the stage must write the compiled artifact');
        assert.equal(jetpack.read(artifact).includes('return [];'), true, 'the default hook rides the first compile');

        // A brand-source edit reaches the artifact on the next stage — this is
        // what the watch does when firestore.rules changes.
        const source = path.join(appPath, 'firestore.rules');
        jetpack.write(source, jetpack.read(source).replace('return [];', 'return [\'xp\'];'));
        stageFunctions({ projectDir: appPath });

        assert.equal(jetpack.read(artifact).includes('return [\'xp\'];'), true, 'a brand-source edit must recompile');
      },
    },

    // Nothing reads a compiled artifact firebase.json does not name.
    {
      name: 'firebase-json-targets-the-compiled-artifact',
      auth: 'none',

      async run({ assert }) {
        const template = jetpack.read(path.join(TEMPLATES_DIR, 'firebase.json'), 'json');
        const fixture = jetpack.read(path.join(FIXTURE_DIR, 'firebase.json'), 'json');

        assert.equal(template.firestore.rules, COMPILED_RULES_FILE, 'the shipped firebase.json must point at the compiled artifact');
        assert.equal(fixture.firestore.rules, COMPILED_RULES_FILE, 'the self-test fixture must point at the compiled artifact');
      },
    },

    // A stale (pre-#255) firebase.json would boot the emulator on the brand
    // half alone — every framework rule silently gone. The build refuses to be
    // quiet about it.
    {
      name: 'a-stale-firebase-json-target-is-reported-loudly',
      auth: 'none',

      async run({ assert }) {
        const appPath = seedApp('omega-rules-stale-', jetpack.read(BRAND_RULES_SEED));
        const warnings = [];

        jetpack.write(path.join(appPath, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules' } }, null, 2));
        compileFirestoreRules({ projectDir: appPath, onWarn: (message) => warnings.push(message) });

        assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`);
        assert.match(warnings[0], /firebase\.json points firestore\.rules at "firestore\.rules"/, 'the warning must name the stale target');
        assert.match(warnings[0], /npx omega setup/, 'the warning must say how to fix it');
      },
    },

    // The brand source is a teaching surface: it has to tell a brand it may
    // call the framework's helpers, and where they are defined.
    {
      name: 'the-seeded-brand-source-documents-the-framework-helpers',
      auth: 'none',

      async run({ assert }) {
        const seed = jetpack.read(BRAND_RULES_SEED);

        assert.equal(seed.includes('OMEGA Rules'), false, 'the seed must carry no managed marker block');
        assert.match(seed, /templates\/firestore\.framework\.rules/, 'the seed must point at the framework half');
        for (const helper of ['belongsTo', 'isAdmin', 'isAuthenticated', 'authUid', 'authEmail', 'existingData', 'incomingData', 'isWritingField']) {
          assert.match(seed, new RegExp(`${helper}\\(`), `the seed must name the ${helper}() helper as callable`);
        }
        assert.match(seed, /TOP-LEVEL: protecting `xp\.total` means listing `'xp'`/, 'the seed must warn that affectedKeys() is top-level');
      },
    },
  ],
};
