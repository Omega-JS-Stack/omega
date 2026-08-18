/**
 * Test: the compiled Firestore rules model
 * ([#255](https://github.com/Omega-JS-Stack/omega/issues/255),
 * [#288](https://github.com/Omega-JS-Stack/omega/issues/288),
 * [#353](https://github.com/Omega-JS-Stack/omega/issues/353)).
 *
 * The brand's `firestore.rules` is SOURCE (pure rules, no hooks); the framework
 * half ships inside this package; every stage compiles the two into
 * `dist/firestore.rules`, which firebase.json points the emulator AND
 * `firebase deploy` at. A brand match block whose path names a framework block
 * MERGES into it, which is how a brand tightens.
 *
 * Everything here is string work against temp dirs — no project, no emulator.
 * What the merged rules DO (a brand condition actually denying a client write,
 * the field helpers on create and update) is proven against the real emulator
 * in test/rules/brand-merge.test.js and test/rules/field-helpers.test.js.
 *
 * Run: npx omega test backend:cli/rules-compile
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const {
  BRAND_RULES_SEED,
  COMPILED_RULES_FILE,
  RETIRED_NAMES,
  RULES_VERSION,
  compileRules,
  compileFirestoreRules,
  ensureBrandRulesSource,
  extractDocumentsBody,
  needsRulesMigration,
} = require('../../src/cli/utils/compile-rules.js');
const { stageFunctions } = require('../../src/cli/utils/stage-functions.js');

const PACKAGE_DIR = path.join(__dirname, '..', '..');
const TEMPLATES_DIR = path.join(PACKAGE_DIR, 'templates');
const FIXTURE_DIR = path.join(PACKAGE_DIR, 'src', 'test', 'fixtures', 'firebase-project');

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

// A v2 (0.36.0) consumer file: the hook era. `protectedFields()` still carries
// the shipped default; `canWriteUser()` carries the brand's own code, and calls
// a helper v3 renamed.
const HOOK_ERA_SOURCE = [
  '// ============================================================================',
  '// YOUR Firestore rules. This file is the SOURCE and it is yours — @omega.js/backend',
  '// never rewrites it (it only appends a framework hook back if one goes missing).',
  '//',
  '//   isAuthenticated()   authUid()            authEmail()',
  '//   belongsTo(id)       isAdmin()            emailVerified()',
  '// ============================================================================',
  'rules_version = \'2\';',
  'service cloud.firestore {',
  '  match /databases/{database}/documents {',
  '    // ─── Your rules ──────────────────────────────────────────────────────────',
  '    match /leaderboards/{id} {',
  '      allow read: if true;',
  '      allow write: if isAdmin();',
  '    }',
  '',
  '    // ─── Framework hooks ─────────────────────────────────────────────────────',
  '    // Both are REQUIRED. The compiler lints for them; a missing hook is',
  '    // re-seeded with the default below and reported loudly.',
  '',
  '    // Top-level `users/{uid}` keys ONLY your backend may write.',
  '    //   e.g. return [\'xp\', \'credits\'];',
  '    function protectedFields() {',
  '      return [];',
  '    }',
  '',
  '    // Extra condition ANDed into the framework\'s `users/{uid}` write rule.',
  '    //   e.g. return emailVerified();',
  '    function canWriteUser() {',
  '      return emailVerified() && incomingData().keys().hasAny([\'profile\']);',
  '    }',
  '  }',
  '}',
  '',
].join('\n');

/**
 * The shipped seed with `rules` written into its own rules region.
 * @param {string} [rules]
 * @returns {string}
 */
function brandSourceWith(rules) {
  const seed = jetpack.read(BRAND_RULES_SEED);
  if (!rules) {
    return seed;
  }

  const lineEnd = seed.indexOf('\n', seed.indexOf('// ─── Your rules ─'));

  return `${seed.slice(0, lineEnd + 1)}${rules}\n${seed.slice(lineEnd + 1)}`;
}

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
  description: 'Compiled Firestore rules: two sources, one artifact, merged by match',
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
        assert.match(header, /MERGED/, 'the header must say that a matching block of yours merges in');
      },
    },

    // One scope, or the halves cannot call each other's functions: Firestore
    // resolves functions within a match block, and ORs `allow` across sibling
    // blocks (the whole reason #255 exists).
    {
      name: 'both-halves-share-one-documents-scope',
      auth: 'none',

      async run({ assert }) {
        const compiled = compileRules({ brandSource: brandSourceWith('    function brandOnlyHelper() {\n      return true;\n    }') }).compiled;
        const body = extractDocumentsBody(compiled, 'compiled');

        assert.equal(compiled.match(/rules_version/g).length, 1, 'exactly one rules_version declaration');
        assert.equal(compiled.match(/service cloud\.firestore/g).length, 1, 'exactly one service block');
        assert.equal((compiled.match(/match \/databases\/\{database\}\/documents/g) || []).length, 1, 'exactly one documents match block');
        assert.match(body, /function brandOnlyHelper\(\)/, 'a brand function must land in the shared scope');
        assert.match(body, /function isUser\(identity\)/, 'the framework helpers must land in the same scope');
      },
    },

    // The merge contract (#353), at the string level: the brand's condition
    // ANDs onto the framework's for the op both blocks declare, and the brand's
    // block does NOT also survive as a sibling (a sibling would only widen).
    {
      name: 'a-brand-block-merges-into-the-framework-block-it-matches',
      auth: 'none',

      async run({ assert }) {
        const { compiled, merged, warnings } = compileRules({
          brandSource: brandSourceWith([
            '    match /users/{uid} {',
            '      allow create, update: if !isWritingAny([\'xp\']) && isEmailVerified();',
            '    }',
          ].join('\n')),
        });

        assert.deepEqual(merged, ['/users/{uid}'], 'the merged block must be reported');
        assert.deepEqual(warnings, [], 'a same-op merge has nothing to warn about');
        assert.match(
          compiled,
          /allow create, update: if isUser\(uid\) && !isWritingFrameworkField\(\) && \(!isWritingAny\(\['xp'\]\) && isEmailVerified\(\)\);/,
          'the brand condition must be parenthesized and ANDed onto the framework\'s',
        );
        assert.equal((compiled.match(/match \/users\/\{uid\} \{/g) || []).length, 1, 'the brand block must be MERGED, never left as a widening sibling');
        assert.match(compiled, /allow read: if isUser\(uid\);/, 'an op the brand said nothing about is untouched');
        assert.match(compiled, /⤷ merged with your firestore\.rules/, 'the artifact must mark what merged into what');
      },
    },

    // Wildcard names are the author's business: blocks pair on the PATH, and
    // the brand's variable is renamed to the framework's inside the fold-in.
    {
      name: 'a-brand-wildcard-name-is-canonicalized-and-renamed',
      auth: 'none',

      async run({ assert }) {
        const { compiled, merged } = compileRules({
          brandSource: brandSourceWith([
            '    match /users/{userId} {',
            '      allow create, update: if isUser(userId);',
            '',
            '      match /journal/{entryId} {',
            '        allow read: if isUser(userId);',
            '      }',
            '    }',
          ].join('\n')),
        });

        // The `⤷ merged` marker quotes the brand's block, so only the RULES
        // (never the comments) have to be free of the brand's own name.
        const code = compiled.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

        assert.deepEqual(merged, ['/users/{uid}'], 'the block must merge despite the different wildcard name');
        assert.equal(code.includes('userId'), false, 'no rule may still name the brand\'s own wildcard');
        assert.match(compiled, /allow create, update: if isUser\(uid\) && !isWritingFrameworkField\(\) && \(isUser\(uid\)\);/, 'the folded condition must read the framework\'s variable');
        assert.match(compiled, /match \/journal\/\{entryId\} \{\n\s+allow read: if isUser\(uid\);/, 'a nested match must splice in, renamed');
      },
    },

    // Everything the framework has no opinion about stays the brand's: a path
    // it never declares passes through, and an op it never declares appends
    // (that op widens, exactly as a sibling block always did). An op that is
    // not the same NAME but covers the same ground — `get` beside the
    // framework's `read` — appends too, and says so out loud.
    {
      name: 'a-brand-only-path-passes-through-and-a-brand-only-op-appends',
      auth: 'none',

      async run({ assert }) {
        const { compiled, warnings } = compileRules({
          brandSource: brandSourceWith([
            '    match /leaderboards/{id} {',
            '      allow read: if true;',
            '    }',
            '',
            '    match /users/{uid} {',
            '      allow delete: if isUser(uid);',
            '      allow get: if isAdmin();',
            '    }',
          ].join('\n')),
        });

        const brandSection = compiled.split('Framework rules (@omega.js/backend)')[0];
        const userBlock = compiled.split('match /users/{uid} {')[1].split('\n    }')[0];

        assert.match(brandSection, /match \/leaderboards\/\{id\} \{/, 'a brand-only path stays in the brand section, untouched');
        assert.match(userBlock, /⤷ from your firestore\.rules\n\s+allow delete: if isUser\(uid\);/, 'a brand-only op appends into the merged block');
        assert.match(userBlock, /allow create, update: if isUser\(uid\) && !isWritingFrameworkField\(\);/, 'the framework ops are untouched by an op it does not declare');
        assert.equal(warnings.length, 1, `expected the widening warning, got ${warnings.length}`);
        assert.match(warnings[0], /your `allow get` overlaps the framework's `allow read`/, 'the widen-not-tighten case must be reported, never silent');

        // The other direction — ONE brand op covering SEVERAL framework ops.
        // The remedy has to name every one of them: obeying `allow create`
        // alone would tighten half the rule and leave `update` widened.
        const { warnings: aliasWarnings } = compileRules({
          brandSource: brandSourceWith([
            '    match /users/{uid} {',
            '      allow write: if isAdmin();',
            '    }',
          ].join('\n')),
        });

        assert.equal(aliasWarnings.length, 1, `expected the widening warning, got ${aliasWarnings.length}`);
        assert.match(aliasWarnings[0], /your `allow write` overlaps the framework's `allow create, update`/, 'the warning must name every framework op the brand op covers');
        assert.match(aliasWarnings[0], /Meant to tighten\? Write `allow create, update`\./, 'the remedy must name every overlapping op, or obeying it half-tightens');
      },
    },

    // A framework statement covering several ops splits only as far as it must.
    {
      name: 'a-multi-op-framework-statement-splits-only-for-the-tightened-op',
      auth: 'none',

      async run({ assert }) {
        const { compiled } = compileRules({
          brandSource: brandSourceWith([
            '    match /payments-carts/{cartId} {',
            '      allow update: if getIncomingData().total < 100;',
            '    }',
          ].join('\n')),
        });

        const block = compiled.split('match /payments-carts/{uid} {')[1].split('\n    }')[0];

        assert.match(block, /allow create: if isUser\(uid\)[\s\S]*?'pending';/, 'the untightened op keeps the framework condition alone');
        assert.match(block, /allow update: if isUser\(uid\)[\s\S]*?'pending' && \(getIncomingData\(\)\.total < 100\);/, 'only the tightened op carries the brand condition');
      },
    },

    // Two brand blocks on the SAME canonical path: the second tightens what
    // the first already produced, in the order they were written. The wildcard
    // shape is the one that used to crash — the merge marker quotes the brand's
    // path, braces and all, so a merged block cannot be re-split on its text.
    {
      name: 'two-brand-blocks-on-one-path-both-tighten-in-order',
      auth: 'none',

      async run({ assert }) {
        const { compiled, merged } = compileRules({
          brandSource: brandSourceWith([
            '    match /users/{userId} {',
            '      allow create, update: if !isWritingAny([\'xp\']);',
            '    }',
            '',
            '    match /users/{uid} {',
            '      allow create, update: if isEmailVerified();',
            '    }',
          ].join('\n')),
        });

        assert.deepEqual(merged, ['/users/{uid}', '/users/{uid}'], 'both blocks must merge into the same framework block');
        assert.match(
          compiled,
          /allow create, update: if isUser\(uid\) && !isWritingFrameworkField\(\) && \(!isWritingAny\(\['xp'\]\)\) && \(isEmailVerified\(\)\);/,
          'both brand conditions must AND on, in the order they were written',
        );
        assert.equal((compiled.match(/match \/users\/\{uid\} \{/g) || []).length, 1, 'the two blocks must land in the ONE framework block');
        assert.equal((compiled.match(/⤷ merged with your firestore\.rules/g) || []).length, 2, 'every merge must be marked, not just the last one');
        assert.match(compiled, /allow read: if isUser\(uid\);/, 'an op neither block declared is untouched');
      },
    },

    // The framework's own user rule declares CREATE and UPDATE by name, and
    // nothing else: `allow write` covered delete too, and every field helper
    // reads incoming data a delete does not carry — so an owner deleting their
    // own user doc was denied by an evaluation ERROR. Naming the two ops the
    // rule actually means leaves delete to the admin catch-all, where it is
    // denied by the rule instead.
    {
      name: 'the-framework-users-rule-declares-create-and-update-only',
      auth: 'none',

      async run({ assert }) {
        const block = compileSeed().split('match /users/{uid} {')[1].split('\n    }')[0];

        assert.match(block, /allow create, update: if isUser\(uid\) && !isWritingFrameworkField\(\);/, 'the write ops must be named, not spelled `write`');
        assert.match(block, /allow read: if isUser\(uid\);/, 'the read rule is unchanged');
        assert.equal(/allow[^:]*\bwrite\b/.test(block), false, 'no `allow write` may survive — it silently covers delete');
        assert.equal(/allow[^:]*\bdelete\b/.test(block), false, 'and delete is deliberately left to the admin catch-all');
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

        assert.match(update, /getIncomingData\(\)\.token == token/, 'update must require the incoming token to equal the doc id');
        assert.match(update, /getIncomingData\(\)\.token == getExistingData\(\)\.token/, 'update must keep the token immutable');
        assert.match(block, /allow get: if true;/, 'get: if true stays by design (token-as-capability)');
      },
    },

    // Migration off the v2 hook era (#353): a hook still carrying its shipped
    // default is deleted, a hook carrying the brand's own code is KEPT as an
    // ordinary function and reported, and calls to renamed helpers are fixed —
    // a rules file calling a function no half defines does not load.
    {
      name: 'a-hook-era-source-drops-default-hooks-and-keeps-a-customized-one',
      auth: 'none',

      async run({ assert }) {
        const appPath = seedApp('omega-rules-hooks-', HOOK_ERA_SOURCE);

        const result = ensureBrandRulesSource({ projectDir: appPath });
        const migrated = jetpack.read(path.join(appPath, 'firestore.rules'));

        assert.equal(result.migrated, true, 'the hook era must be detected');
        assert.deepEqual(result.strippedHooks, ['protectedFields'], 'the default-bodied hook must be reported as stripped');
        assert.deepEqual(result.keptHooks, ['canWriteUser'], 'the customized hook must be reported as kept');

        assert.equal(migrated.includes('function protectedFields('), false, 'the default-bodied hook must be gone');
        assert.match(migrated, /function canWriteUser\(\) \{/, 'the customized hook must survive as a plain function');
        assert.match(migrated, /getIncomingData\(\)\.keys\(\)\.hasAny\(\['profile'\]\)/, 'the brand\'s own condition must survive, with only its renamed calls rewritten');
        assert.match(migrated, /Kept from the retired `canWriteUser\(\)` framework hook/, 'the kept function must say why it is still there');
        assert.match(migrated, /isEmailVerified\(\)/, 'a call to a renamed helper must be renamed with it');
        assert.equal(/\bemailVerified\(\)/.test(migrated.replace(/isEmailVerified/g, '')), false, 'no call to the old name may survive');

        assert.match(migrated, /match \/leaderboards\/\{id\}/, 'the brand\'s own rules must survive the migration');
        assert.equal(migrated.includes('─── Framework hooks ───'), false, 'the hook section header must go with the hooks');
        assert.equal(migrated.includes('Both are REQUIRED'), false, 'the hook-era instructions must go with them');
        assert.match(migrated, /MERGE-BY-MATCH/, 'the stale header must be replaced with the current one');

        // Idempotent: a second setup has nothing left to do.
        const second = ensureBrandRulesSource({ projectDir: appPath });
        assert.equal(second.migrated, false, 'the migration must run once');
        assert.equal(jetpack.read(path.join(appPath, 'firestore.rules')), migrated, 'a second setup must not touch the file');

        // …and the question SETTLES. The kept function is the brand's own code
        // now, so a migrated file must stop answering "unmigrated" — otherwise
        // every future setup re-reports it and re-prints the warning forever.
        assert.equal(needsRulesMigration(migrated), false, 'a migrated file must stop reporting as unmigrated');

        // …and what it produced compiles.
        const { compiled } = compileRules({ brandSource: migrated });
        assert.match(compiled, /match \/leaderboards\/\{id\}/, 'the compiled artifact carries the brand rules');
        assert.match(compiled, /match \/notifications\/\{token\}/, 'the compiled artifact carries the framework rules');
      },
    },

    // Migration: a pre-#255 file converts ONCE, custom region intact, markers
    // gone.
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
        assert.equal(migrated.includes('function protectedFields('), false, 'the migration must seed no hooks — they are retired');

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

        // A brand-source edit reaches the artifact on the next stage — this is
        // what the watch does when firestore.rules changes.
        const source = path.join(appPath, 'firestore.rules');
        jetpack.write(source, brandSourceWith('    match /posts/{id} {\n      allow read: if true;\n    }'));
        stageFunctions({ projectDir: appPath });

        assert.equal(jetpack.read(artifact).includes('match /posts/{id} {'), true, 'a brand-source edit must recompile');
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

    // The brand source is a teaching surface: it has to tell a brand how the
    // merge works and which helpers it may call.
    {
      name: 'the-seeded-brand-source-teaches-the-merge-and-the-helpers',
      auth: 'none',

      async run({ assert }) {
        const seed = jetpack.read(BRAND_RULES_SEED);

        assert.equal(seed.includes('OMEGA Rules'), false, 'the seed must carry no managed marker block');
        assert.match(seed, /templates\/firestore\.framework\.rules/, 'the seed must point at the framework half');
        assert.match(seed, /MERGE-BY-MATCH/, 'the seed must teach the merge model');
        assert.match(seed, /allow create, update: if isUser\(uid\) && !isWritingFrameworkField\(\) && \(!isWritingAny\(\['xp'\]\) && isEmailVerified\(\)\);/, 'the seed must carry the worked example of a merge');
        for (const helper of ['isUser', 'isAdmin', 'isAuthenticated', 'getAuthUid', 'getAuthEmail', 'getRoles', 'getExistingData', 'getIncomingData', 'isWritingField', 'isWritingAny', 'isOwner', 'isEmailVerified']) {
          assert.match(seed, new RegExp(`${helper}\\(`), `the seed must name the ${helper}() helper as callable`);
        }
        assert.match(seed, /TOP-LEVEL: protecting `xp\.total` means listing `'xp'`/, 'the seed must warn that the field list is top-level');
      },
    },

    // The rename sweep (#353): no retired name survives on a RULES surface —
    // the two shipped halves, the artifact they compile to, and the CLI code
    // that writes them. It covers every retirement in one list, so settling the
    // API a second time (`belongsTo` → `isUser`, the value helpers onto `get*`)
    // extends the gate by extending the migration map. Deliberately not a
    // whole-tree grep: `emailVerified` is also a Firebase Auth user-record
    // property and `existingData` an ordinary variable name all over the
    // backend (different namespaces entirely), and the docs and these suites
    // have to name the retired symbols to explain the migration. The compiler
    // is exempt for the same reason — migrating those names off a consumer's
    // file is its job.
    {
      name: 'no-retired-name-survives-the-rename-sweep',
      auth: 'none',

      async run({ assert }) {
        const exempt = [path.join(PACKAGE_DIR, 'src', 'cli', 'utils', 'compile-rules.js')];
        const files = [
          ...jetpack.find(TEMPLATES_DIR, { matching: '*.rules' }).map((file) => path.resolve(file)),
          ...jetpack.find(path.join(PACKAGE_DIR, 'src', 'cli'), { matching: '*.js' }).map((file) => path.resolve(file)),
        ].filter((file) => !exempt.includes(file));

        const offenders = [];
        for (const file of files) {
          const contents = jetpack.read(file);
          for (const name of RETIRED_NAMES) {
            if (new RegExp(`\\b${name}\\b`).test(contents)) {
              offenders.push(`${path.relative(PACKAGE_DIR, file)}: ${name}`);
            }
          }
        }

        assert.deepEqual(offenders, [], `retired names still in the tree: ${offenders.join(', ')}`);

        // …and the artifact a consumer deploys names none of them either.
        const compiled = compileSeed();
        for (const name of RETIRED_NAMES) {
          assert.equal(new RegExp(`\\b${name}\\b`).test(compiled), false, `the compiled ruleset must not name ${name}`);
        }
      },
    },
  ],
};
