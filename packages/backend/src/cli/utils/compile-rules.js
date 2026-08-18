/**
 * compile-rules — the compiled Firestore rules model
 * ([#255](https://github.com/Omega-JS-Stack/omega/issues/255)).
 *
 * Firestore ORs `allow` across sibling match blocks, so a brand's own
 * `match /users/{uid}` can only WIDEN the framework's — never tighten it. The
 * old model (a framework-owned marker block regenerated inside the brand's
 * `firestore.rules`) therefore had no way for a brand to protect a field of
 * its own, and hand-edits to the managed block were wiped on the next setup.
 *
 * The model now:
 *
 *   brand   firestore.rules                     ← SOURCE, the brand's, pure rules
 *   + framework templates/firestore.framework.rules  ← ships inside this package
 *   = dist/firestore.rules                      ← GENERATED artifact, deployed
 *
 * Both halves are spliced into ONE `match /databases/{database}/documents`
 * scope, so functions resolve across the seam in both directions: a brand's
 * rules call framework helpers, and the framework's user-doc write rule calls
 * the two BRAND HOOKS (`protectedFields()`, `canWriteUser()`).
 *
 * Splitting the work:
 *   - `compileFirestoreRules()` writes dist/ ONLY (the build step, run on every
 *     stage). A missing hook is re-seeded into the ARTIFACT so the ruleset is
 *     always valid, and reported loudly.
 *   - `ensureBrandRulesSource()` writes the brand's authored file (the setup
 *     step): seeds it, migrates a legacy marker-block file once, and appends a
 *     hook that went missing so the brand can edit it.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

// The rules SCHEMA version — the stamp in the compiled artifact's header and in
// `database.rules.json`'s marker block. Bumps ONLY when the generated rule
// semantics change, never with the package version (tying it to the package
// version made every release rewrite every consumer's rules files). v2.0.0 is
// the compiled model (#255) + the notifications malformed-doc guard (#288).
const RULES_VERSION = '2.0.0';

// The brand's authored source, at the app root — the file the brand edits.
const BRAND_RULES_FILE = 'firestore.rules';

// The compiled artifact, inside the staged output tree (src/dist pillar:
// dist/ is the generated tree every runtime surface reads — emulator, serve,
// test, deploy). Relative to the app root, which is how firebase.json spells
// it. Re-created by every stage, so it can never go stale or missing.
const COMPILED_RULES_FILE = 'dist/firestore.rules';

// The two halves that ship inside this package.
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', 'templates');
const FRAMEWORK_RULES_TEMPLATE = path.join(TEMPLATES_DIR, 'firestore.framework.rules');
const BRAND_RULES_SEED = path.join(TEMPLATES_DIR, BRAND_RULES_FILE);

// The hooks the framework half calls into. The lint list grows with the
// framework: a new hook lands here and consumers get its stub on next setup.
const BRAND_HOOKS = ['protectedFields', 'canWriteUser'];

// The seed's example-rules block — what a migration replaces with the brand's
// own extracted rules. Kept verbatim in templates/firestore.rules.
const SEED_RULES_PLACEHOLDER = [
  '    // match /posts/{id} {',
  '    //   allow read: if true;',
  '    //   allow write: if isAdmin();',
  '    // }',
].join('\n');

function defaultWarn(message) {
  console.warn(chalk.yellow(message));
}

/**
 * The body of the `match /databases/{database}/documents { … }` block.
 *
 * Brace-matched rather than regexed: a rules file nests match blocks and
 * functions arbitrarily deep. Comments and string literals are skipped so a
 * `// }` never closes a block.
 * @param {string} source - A whole rules file.
 * @param {string} label - What to name the file in an error.
 * @returns {string} The block's inner text (indentation preserved).
 */
function extractDocumentsBody(source, label) {
  const opener = /match\s+\/databases\/\{[A-Za-z0-9_]+\}\/documents\s*\{/.exec(source);
  if (!opener) {
    throw new Error(`${label}: no \`match /databases/{database}/documents\` block found — a Firestore rules file must carry one`);
  }

  const open = opener.index + opener[0].length - 1;
  const close = findClosingBrace(source, open, label);

  return source.slice(open + 1, close);
}

/**
 * Index of the `}` closing the `{` at `open`, skipping comments and strings.
 * @param {string} source
 * @param {number} open - Index of the opening brace.
 * @param {string} label - What to name the file in an error.
 * @returns {number}
 */
function findClosingBrace(source, open, label) {
  let depth = 0;

  for (let i = open; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      i = source.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (char === '\'' || char === '"') {
      const end = source.indexOf(char, i + 1);
      if (end === -1) break;
      i = end;
      continue;
    }

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  throw new Error(`${label}: unbalanced braces — could not find the block closing the one at offset ${open}`);
}

/**
 * Is `name` defined as a function anywhere in this rules text?
 * @param {string} source
 * @param {string} name
 * @returns {boolean}
 */
function hasFunction(source, name) {
  return new RegExp(`function\\s+${name}\\s*\\(`).test(source);
}

/**
 * The lint: which required hooks a brand source does not define. The ONE place
 * that question is answered — the compiler, setup's check, and the tests all
 * ask here.
 * @param {string} brandSource - The brand's whole firestore.rules.
 * @returns {string[]}
 */
function missingBrandHooks(brandSource) {
  const body = extractDocumentsBody(brandSource, BRAND_RULES_FILE);

  return BRAND_HOOKS.filter((hook) => !hasFunction(body, hook));
}

/**
 * A function definition plus the comment lines directly above it — the shape a
 * re-seed writes back, so the brand gets the docs with the stub.
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
function extractFunctionBlock(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!match) {
    // The seed template IS this package's file — a hook missing from it means
    // the template and BRAND_HOOKS drifted, which no consumer can fix.
    throw new Error(`templates/${BRAND_RULES_FILE}: no \`function ${name}()\` to seed from`);
  }

  const open = match.index + match[0].length - 1;
  const end = findClosingBrace(source, open, `templates/${BRAND_RULES_FILE}`);

  // Keep the function's own indentation, and walk back over the contiguous
  // `//` comment lines introducing it.
  const lineStart = source.lastIndexOf('\n', match.index) + 1;
  const before = source.slice(0, lineStart).split('\n');
  before.pop(); // The empty tail after the final newline
  let first = before.length;
  while (first > 0 && before[first - 1].trim().startsWith('//')) {
    first--;
  }

  return [...before.slice(first), source.slice(lineStart, end + 1)].join('\n');
}

/**
 * The compiled artifact's header — the ONE place a reader learns where the
 * two sources live and which one to edit (Ian's clarity requirement, #255).
 * @returns {string}
 */
function compiledHeader() {
  return [
    '// ============================================================================',
    '//  GENERATED FILE — DO NOT EDIT.',
    '//',
    `//  Compiled by @omega.js/backend (rules schema v${RULES_VERSION}) from TWO sources:`,
    '//',
    `//    1. YOUR rules + hooks   ./${BRAND_RULES_FILE}`,
    '//       ^ EDIT THAT FILE — everything a brand owns lives there.',
    '//    2. Framework rules      ./node_modules/@omega.js/backend/templates/firestore.framework.rules',
    '//       ^ ships inside @omega.js/backend; upgrade the package to change it.',
    '//',
    `//  Rebuilt by every \`omega build\` (and so by setup, emulator, serve, test and`,
    `//  deploy). firebase.json points BOTH the emulator and \`firebase deploy\` at`,
    '//  this file, and every edit made here is overwritten on the next build.',
    '// ============================================================================',
  ].join('\n');
}

/**
 * Compile the framework half + a brand half into one deployable ruleset.
 *
 * Pure string work — no disk writes, so the tests can compile any brand source
 * they like. A hook the brand half is missing is re-seeded into the OUTPUT
 * (the artifact must always be a valid ruleset) and named in `reseeded`.
 *
 * An UNMIGRATED (legacy marker-block) source throws: its managed block still
 * carries the framework's own functions, so splicing it in would emit every one
 * of them twice — a ruleset Firestore refuses to load. There is no valid
 * artifact to produce from that input, so nothing pretends otherwise.
 * @param {object} options
 * @param {string} options.brandSource - The brand's whole firestore.rules.
 * @returns {{ compiled: string, reseeded: string[] }}
 */
function compileRules(options) {
  if (isLegacyMarkerFile(options.brandSource)) {
    throw new Error(`${BRAND_RULES_FILE} still carries the legacy OMEGA Rules marker block, which redefines the framework's own functions — compiling it would emit a duplicate-function ruleset that cannot load. Run \`npx omega setup\` to migrate it (your custom rules are kept).`);
  }

  const seed = jetpack.read(BRAND_RULES_SEED);
  const framework = jetpack.read(FRAMEWORK_RULES_TEMPLATE);
  const brandBody = extractDocumentsBody(options.brandSource, BRAND_RULES_FILE);
  const frameworkBody = extractDocumentsBody(framework, 'firestore.framework.rules');

  const reseeded = missingBrandHooks(options.brandSource);
  const stubs = reseeded.map((hook) => extractFunctionBlock(seed, hook));

  const compiled = [
    compiledHeader(),
    'rules_version = \'2\';',
    'service cloud.firestore {',
    '  match /databases/{database}/documents {',
    '    // ─── Brand rules + hooks (from firestore.rules) ───────────────────────',
    trimBlankEdges(brandBody),
    ...(stubs.length ? ['', '    // ─── Hooks re-seeded by the compiler (missing from firestore.rules) ───', ...stubs] : []),
    '',
    '    // ─── Framework rules (@omega.js/backend) ──────────────────────────────',
    trimBlankEdges(frameworkBody),
    '  }',
    '}',
    '',
  ].join('\n');

  return { compiled, reseeded };
}

/**
 * Compile and write `dist/firestore.rules` for a consumer app.
 *
 * Writes the STAGED tree only — never the brand's authored file (that is
 * `ensureBrandRulesSource`'s job). A brand with no source file yet (first
 * setup, before the seed lands) compiles against the seed so the emulator
 * still boots.
 *
 * An UNMIGRATED source is reported and SKIPPED rather than thrown on: the
 * stage runs before setup's checks do, so a throw here would kill the very run
 * that migrates the file. Skipping leaves no artifact for firebase.json to
 * name, which fails loudly at the next surface that wants one — and the build
 * still never writes the brand's authored file (#255).
 * @param {object} options
 * @param {string} options.projectDir - The app root.
 * @param {function} [options.onWarn] - Loud reporter (defaults to a yellow console line).
 * @returns {{ compiledPath: string, reseeded: string[], seededFallback: boolean, refused: boolean }}
 */
function compileFirestoreRules(options) {
  const projectDir = options.projectDir;
  const onWarn = options.onWarn || defaultWarn;
  const sourcePath = path.join(projectDir, BRAND_RULES_FILE);
  const compiledPath = path.join(projectDir, COMPILED_RULES_FILE);

  const seededFallback = !jetpack.exists(sourcePath);
  if (seededFallback) {
    onWarn(`No ${BRAND_RULES_FILE} at the app root — compiling the framework half against the shipped defaults. Run \`npx omega setup\` to seed your own.`);
  }

  const brandSource = seededFallback ? jetpack.read(BRAND_RULES_SEED) : jetpack.read(sourcePath);

  if (isLegacyMarkerFile(brandSource)) {
    onWarn(`${BRAND_RULES_FILE} still carries the legacy OMEGA Rules marker block, which redefines the framework's own functions — refusing to write a duplicate-function ${COMPILED_RULES_FILE} that cannot load. Run \`npx omega setup\` to migrate it (your custom rules are kept).`);

    return { compiledPath, reseeded: [], seededFallback, refused: true };
  }

  const { compiled, reseeded } = compileRules({ brandSource });

  for (const hook of reseeded) {
    onWarn(`${BRAND_RULES_FILE} is missing the \`${hook}()\` hook — the compiler re-seeded its default into ${COMPILED_RULES_FILE}. Run \`npx omega setup\` to write the stub back into your source file.`);
  }

  jetpack.write(compiledPath, compiled);

  // The artifact is worthless if nothing reads it. A pre-#255 firebase.json
  // still names the brand SOURCE, which would boot the emulator (and deploy)
  // on the brand half alone — every framework rule silently gone. The build
  // does not rewrite authored config (that is setup's job), but it refuses to
  // be quiet about it.
  const firebaseJSON = jetpack.read(path.join(projectDir, 'firebase.json'), 'json');
  const target = firebaseJSON?.firestore?.rules;
  if (firebaseJSON && target !== COMPILED_RULES_FILE) {
    onWarn(`firebase.json points firestore.rules at "${target}" — it must be "${COMPILED_RULES_FILE}" (the compiled artifact) or the framework rules never load. Run \`npx omega setup\`.`);
  }

  return { compiledPath, reseeded, seededFallback, refused: false };
}

/**
 * Seed / migrate / repair the brand's AUTHORED firestore.rules.
 *
 * Three jobs, all idempotent and all setup's (never the build's — the build
 * writes dist/ only):
 *   - no file          → write the seed
 *   - legacy markers   → extract the non-managed region into the new source ONCE
 *   - hook missing     → append its default stub, so the brand can edit it
 * @param {object} options
 * @param {string} options.projectDir - The app root.
 * @returns {{ created: boolean, migrated: boolean, reseeded: string[] }}
 */
function ensureBrandRulesSource(options) {
  const projectDir = options.projectDir;
  const sourcePath = path.join(projectDir, BRAND_RULES_FILE);
  const seed = jetpack.read(BRAND_RULES_SEED);
  const result = { created: false, migrated: false, reseeded: [] };

  let contents = jetpack.exists(sourcePath) ? jetpack.read(sourcePath) : '';

  if (!contents.trim()) {
    jetpack.write(sourcePath, seed);
    return { ...result, created: true };
  }

  if (isLegacyMarkerFile(contents)) {
    contents = migrateLegacyMarkerFile(contents);
    result.migrated = true;
  }

  for (const hook of missingBrandHooks(contents)) {
    contents = appendHook(contents, extractFunctionBlock(seed, hook));
    result.reseeded.push(hook);
  }

  if (result.migrated || result.reseeded.length) {
    jetpack.write(sourcePath, contents);
  }

  return result;
}

/**
 * A pre-#255 rules file: the framework's marker block regenerated in place.
 * @param {string} contents
 * @returns {boolean}
 */
function isLegacyMarkerFile(contents) {
  // Fresh regex per call — the shared one is /g and carries lastIndex.
  return /\/\/ ========== OMEGA Rules \(v.*?\) ==========/.test(contents);
}

/**
 * Convert a legacy marker-block file into the new source: drop the managed
 * block, keep everything the brand wrote, and land it in the seed's shape
 * (header docs + hooks). Runs ONCE — the result carries no markers.
 * @param {string} contents - The legacy file.
 * @returns {string} The new brand source.
 */
function migrateLegacyMarkerFile(contents) {
  const seed = jetpack.read(BRAND_RULES_SEED);
  const stripped = contents.replace(/\/\/ ========== OMEGA Rules \(v.*?\) ==========.*?\/\/ ========== End OMEGA Rules ==========/s, '');
  const custom = trimBlankEdges(extractDocumentsBody(stripped, BRAND_RULES_FILE));

  if (!seed.includes(SEED_RULES_PLACEHOLDER)) {
    // The placeholder is a literal block of templates/firestore.rules, in this
    // same package — drift here is a framework bug, never a consumer's.
    throw new Error(`templates/${BRAND_RULES_FILE}: the example-rules placeholder the migration replaces is gone`);
  }

  return seed.replace(SEED_RULES_PLACEHOLDER, custom.trim() ? custom : SEED_RULES_PLACEHOLDER);
}

/**
 * Append a hook stub at the end of the documents block.
 * @param {string} contents - The whole brand source.
 * @param {string} block - The stub (comments + function).
 * @returns {string}
 */
function appendHook(contents, block) {
  const opener = /match\s+\/databases\/\{[A-Za-z0-9_]+\}\/documents\s*\{/.exec(contents);
  const close = findClosingBrace(contents, opener.index + opener[0].length - 1, BRAND_RULES_FILE);
  const lineStart = contents.lastIndexOf('\n', close) + 1;
  const indent = contents.slice(lineStart, close);

  return `${contents.slice(0, lineStart).replace(/\s+$/, '')}\n\n${block}\n${indent}${contents.slice(close)}`;
}

/**
 * Drop leading/trailing blank lines, keeping indentation on the rest.
 * @param {string} text
 * @returns {string}
 */
function trimBlankEdges(text) {
  return text.replace(/^(\s*\n)+/, '').replace(/(\n\s*)+$/, '');
}

module.exports = {
  RULES_VERSION,
  BRAND_RULES_FILE,
  BRAND_RULES_SEED,
  COMPILED_RULES_FILE,
  FRAMEWORK_RULES_TEMPLATE,
  BRAND_HOOKS,
  compileRules,
  compileFirestoreRules,
  ensureBrandRulesSource,
  extractDocumentsBody,
  isLegacyMarkerFile,
  missingBrandHooks,
};
