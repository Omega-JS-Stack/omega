/**
 * compile-rules — the compiled Firestore rules model
 * ([#255](https://github.com/Omega-JS-Stack/omega/issues/255)) and its
 * merge-by-match contract
 * ([#353](https://github.com/Omega-JS-Stack/omega/issues/353)).
 *
 * Firestore ORs `allow` across sibling match blocks, so a brand's own
 * `match /users/{uid}` can only WIDEN the framework's — never tighten it. The
 * model:
 *
 *   brand   firestore.rules                          ← SOURCE, the brand's, pure rules
 *   + framework templates/firestore.framework.rules  ← ships inside this package
 *   = dist/firestore.rules                           ← GENERATED artifact, deployed
 *
 * Both halves are spliced into ONE `match /databases/{database}/documents`
 * scope, so functions resolve across the seam in both directions.
 *
 * MERGE-BY-MATCH is how a brand tightens: a brand match block whose path
 * matches a framework block's (wildcard names normalized) is MERGED into it —
 * for an op BOTH declare, the brand's condition is parenthesized and ANDed onto
 * the framework's; an op only the brand declares appends verbatim; nested
 * matches splice in. A brand writes ordinary rules; nothing hooks into
 * anything. The v2 hook functions (`protectedFields()`, `canWriteUser()`) are
 * RETIRED — see `ensureBrandRulesSource`, which migrates them out.
 *
 * Splitting the work:
 *   - `compileFirestoreRules()` writes dist/ ONLY (the build step, run on every
 *     stage).
 *   - `ensureBrandRulesSource()` writes the brand's authored file (the setup
 *     step): seeds it, and migrates a legacy marker-block or hook-era file once.
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

// The rules SCHEMA version — the stamp in the compiled artifact's header and in
// `database.rules.json`'s marker block. Bumps ONLY when the generated rule
// semantics change, never with the package version (tying it to the package
// version made every release rewrite every consumer's rules files). v2.0.0 was
// the compiled model (#255) + the notifications malformed-doc guard (#288);
// v3.0.0 is merge-by-match + the settled helper API (#353).
const RULES_VERSION = '3.0.0';

// The brand's authored source, at the target root — the file the brand edits.
const BRAND_RULES_FILE = 'firestore.rules';

// The compiled artifact, inside the staged output tree (src/dist pillar:
// dist/ is the generated tree every runtime surface reads — emulator, serve,
// test, deploy). Relative to the target root, which is how firebase.json spells
// it. Re-created by every stage, so it can never go stale or missing.
const COMPILED_RULES_FILE = 'dist/firestore.rules';

// The deliberate, run-alone step that moves a brand onto the compiled model —
// never a side effect of another verb
// ([#522](https://github.com/Omega-JS-Stack/omega/issues/522)).
const RULES_MIGRATION_COMMAND = 'npx omega migrate:rules';

// The one-time conversion of a PRE-FAMILY marker file onto the family grammar
// ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)). Every evergreen
// verb speaks ONLY the family, so a tree carried over from BEM converges at no
// verb until this one has run — the verbs DETECT the old shapes and point here,
// never convert.
const MARKER_MIGRATION_COMMAND = 'npx omega migrate:markers';

// The two halves that ship inside this package.
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', 'templates');
const FRAMEWORK_RULES_TEMPLATE = path.join(TEMPLATES_DIR, 'firestore.framework.rules');
const BRAND_RULES_SEED = path.join(TEMPLATES_DIR, BRAND_RULES_FILE);

// The v2 hooks and the DEFAULT body each shipped with. A brand file carrying
// the default body had never edited it: the migration deletes it outright. A
// body that differs is the brand's own work and is KEPT (as a plain function)
// and reported.
const RETIRED_HOOKS = {
  protectedFields: 'return [];',
  canWriteUser: 'return true;',
};

// The helpers v3 RENAMED, old → new. A brand source still CALLING one names a
// function no half defines any more, so the migration renames the call. Both
// eras are here: the v2 (0.36.0) names, and the ones v3 itself carried before
// the API settled on `is*` predicates + `get*` values — v3 never shipped, so a
// brand can only have the first kind, but naming both keeps ONE map honest.
const RENAMED_HELPERS = {
  emailVerified: 'isEmailVerified',
  isWritingProtectedUserField: 'isWritingFrameworkField',
  belongsTo: 'isUser',
  authUid: 'getAuthUid',
  authEmail: 'getAuthEmail',
  existingData: 'getExistingData',
  incomingData: 'getIncomingData',
};

// Every name v3 retired: the two hooks plus the renamed helpers. A brand source
// naming one is pre-v3 and gets migrated, and the rename sweep greps this list.
const RETIRED_NAMES = [...Object.keys(RETIRED_HOOKS), ...Object.keys(RENAMED_HELPERS)];

// Firestore's `allow` aliases in primitive terms. Merge-by-match pairs ops by
// NAME, so a brand `allow create` beside a framework `allow write` does not
// tighten it — Firestore ORs the two. That case is reported, never silent.
const OP_ALIASES = { read: ['get', 'list'], write: ['create', 'update', 'delete'] };

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
 * The index just past the comment or string literal starting at `index`, or -1
 * when code starts there. The ONE place the parser knows what is not code, so a
 * `// }` never closes a block and a `'match /x'` never opens one.
 * @param {string} source
 * @param {number} index
 * @returns {number}
 */
function skipNonCode(source, index) {
  const char = source[index];
  const next = source[index + 1];

  if (char === '/' && next === '/') {
    const end = source.indexOf('\n', index);
    return end === -1 ? source.length : end;
  }
  if (char === '/' && next === '*') {
    const end = source.indexOf('*/', index + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (char === '\'' || char === '"') {
    const end = source.indexOf(char, index + 1);
    return end === -1 ? source.length : end + 1;
  }

  return -1;
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
    const skip = skipNonCode(source, i);
    if (skip !== -1) {
      i = skip - 1;
      continue;
    }

    const char = source[i];
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
 * The body of the `match /databases/{database}/documents { … }` block.
 *
 * Brace-matched rather than regexed: a rules file nests match blocks and
 * functions arbitrarily deep.
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
 * Parse a rules block's body into its top-level nodes: `match` blocks,
 * `function` definitions, `allow` statements, and the plain text between them
 * (comments, blank lines).
 *
 * Every node keeps its RAW text and they tile the input end to end, so
 * concatenating them reproduces the body byte for byte — the merge rewrites the
 * two or three nodes it touches and re-emits everything else untouched.
 * @param {string} body - A block's inner text.
 * @param {string} label - What to name the file in an error.
 * @returns {object[]}
 */
function parseNodes(body, label) {
  const nodes = [];
  let plainStart = 0;
  let index = 0;

  const pushPlain = (end) => {
    if (end > plainStart) {
      nodes.push({ type: 'text', raw: body.slice(plainStart, end) });
    }
  };

  while (index < body.length) {
    const skip = skipNonCode(body, index);
    if (skip !== -1) {
      index = skip;
      continue;
    }

    // Keywords only count at a token boundary: `isMatching(` is not a block.
    if (/[A-Za-z0-9_]/.test(body[index - 1] || '')) {
      index++;
      continue;
    }

    const rest = body.slice(index);

    // A match PATH carries braces of its own (`/users/{uid}`), so it is spelled
    // out segment by segment rather than "everything up to the first {".
    const block = /^match\s+((?:\/(?:[A-Za-z0-9_.$~%-]+|\{[A-Za-z0-9_]+(?:=\*\*)?\}))+)\s*\{/.exec(rest)
      || /^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/.exec(rest);
    if (block) {
      const isMatch = block[0].startsWith('match');
      const open = index + block[0].length - 1;
      const close = findClosingBrace(body, open, label);

      pushPlain(index);
      nodes.push({
        type: isMatch ? 'match' : 'function',
        path: isMatch ? block[1] : null,
        name: isMatch ? null : block[1],
        inner: body.slice(open + 1, close),
        indent: lineIndent(body, index),
        raw: body.slice(index, close + 1),
      });
      index = close + 1;
      plainStart = index;
      continue;
    }

    const allow = /^allow\s+([a-z]+(?:\s*,\s*[a-z]+)*)\s*:\s*if\s/.exec(rest);
    if (allow) {
      const conditionStart = index + allow[0].length;
      const end = findStatementEnd(body, conditionStart, label);

      pushPlain(index);
      nodes.push({
        type: 'allow',
        ops: allow[1].split(',').map((op) => op.trim()),
        condition: body.slice(conditionStart, end).trim(),
        indent: lineIndent(body, index),
        raw: body.slice(index, end + 1),
      });
      index = end + 1;
      plainStart = index;
      continue;
    }

    index++;
  }

  pushPlain(body.length);

  return nodes;
}

/**
 * Index of the `;` ending the statement that starts at `index`.
 * @param {string} source
 * @param {number} index
 * @param {string} label - What to name the file in an error.
 * @returns {number}
 */
function findStatementEnd(source, index, label) {
  for (let i = index; i < source.length; i++) {
    const skip = skipNonCode(source, i);
    if (skip !== -1) {
      i = skip - 1;
      continue;
    }
    if (source[i] === ';') {
      return i;
    }
  }

  throw new Error(`${label}: an \`allow\` statement at offset ${index} is never terminated with \`;\``);
}

/**
 * The indentation of the line `index` sits on, or '' when code precedes it.
 * @param {string} source
 * @param {number} index
 * @returns {string}
 */
function lineIndent(source, index) {
  const start = source.lastIndexOf('\n', index - 1) + 1;
  const before = source.slice(start, index);

  return /^\s*$/.test(before) ? before : '';
}

/**
 * A match path with its wildcard NAMES normalized away, so `/users/{uid}` and
 * `/users/{userId}` are the same block — and `/{doc=**}` (recursive) stays
 * distinct from `/{doc}` (one segment).
 * @param {string} matchPath
 * @returns {string}
 */
function canonicalPath(matchPath) {
  return matchPath.trim().replace(/\{[A-Za-z0-9_]+(=\*\*)?\}/g, (whole, recursive) => (recursive ? '{**}' : '{*}'));
}

/**
 * The wildcard variable names of a match path, in order.
 * @param {string} matchPath
 * @returns {string[]}
 */
function wildcardNames(matchPath) {
  return [...matchPath.matchAll(/\{([A-Za-z0-9_]+)(?:=\*\*)?\}/g)].map((match) => match[1]);
}

/**
 * Rename identifiers in rules text, skipping comments and string literals —
 * how a brand's `{userId}` becomes the framework's `{uid}` inside the merged
 * conditions.
 * @param {string} text
 * @param {object} renames - `{ from: to }`.
 * @returns {string}
 */
function renameIdentifiers(text, renames) {
  const names = Object.keys(renames);
  if (!names.length) {
    return text;
  }

  const identifier = /[A-Za-z0-9_]/;
  let output = '';
  let index = 0;

  while (index < text.length) {
    const skip = skipNonCode(text, index);
    if (skip !== -1) {
      output += text.slice(index, skip);
      index = skip;
      continue;
    }

    const rest = text.slice(index);
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (word && !identifier.test(text[index - 1] || '')) {
      output += Object.prototype.hasOwnProperty.call(renames, word[0]) ? renames[word[0]] : word[0];
      index += word[0].length;
      continue;
    }

    output += text[index];
    index++;
  }

  return output;
}

/**
 * Shift every line of `text` from one indentation to another, so a brand's
 * block reads correctly once it lands inside the framework's.
 * @param {string} text
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function reindent(text, from, to) {
  if (from === to) {
    return text;
  }

  return text
    .split('\n')
    .map((line) => {
      if (!line.trim()) {
        return '';
      }
      return line.startsWith(from) ? to + line.slice(from.length) : to + line.trim();
    })
    .join('\n');
}

/**
 * Merge ONE brand match block into the framework block it matches.
 *
 * Shared op → the brand's condition is parenthesized and ANDed onto the
 * framework's (the tighten lane; a framework statement listing several ops
 * splits only as far as it must). Brand-only op → appended verbatim (that op
 * keeps today's sibling-OR widening). Anything else in the brand block (nested
 * matches, its own functions) splices in as written.
 *
 * The result comes back in PARTS rather than re-found in the merged text: the
 * marker comment quotes the brand's path, braces and all, so nothing
 * downstream can locate the block's own brace by scanning for one.
 * @param {object} frameworkNode - A parsed framework `match` node, carrying the
 *   `markers` and `label` any earlier merge into it left behind.
 * @param {object} brandNode - The parsed brand `match` node merging into it.
 * @param {string[]} warnings - Collector for ops that widen instead of tighten.
 * @returns {{ raw: string, inner: string, markers: string[] }}
 */
function mergeMatchBlock(frameworkNode, brandNode, warnings) {
  const label = `${BRAND_RULES_FILE} match ${brandNode.path}`;
  const renames = {};
  const brandWildcards = wildcardNames(brandNode.path);

  wildcardNames(frameworkNode.path).forEach((name, position) => {
    if (brandWildcards[position] && brandWildcards[position] !== name) {
      renames[brandWildcards[position]] = name;
    }
  });

  const brandChildren = parseNodes(renameIdentifiers(brandNode.inner, renames), label);
  const frameworkChildren = parseNodes(frameworkNode.inner, frameworkNode.label);
  const frameworkOps = new Set(frameworkChildren.filter((node) => node.type === 'allow').flatMap((node) => node.ops));

  // What the brand asks of each op it names.
  const brandConditions = new Map();
  for (const node of brandChildren) {
    if (node.type === 'allow') {
      for (const op of node.ops) {
        brandConditions.set(op, node.condition);
      }
    }
  }

  const childIndent = frameworkChildren.find((node) => node.type === 'allow')?.indent || `${frameworkNode.indent}  `;
  let inner = '';

  for (const node of frameworkChildren) {
    if (node.type !== 'allow' || !node.ops.some((op) => brandConditions.has(op))) {
      inner += node.raw;
      continue;
    }

    // One statement per distinct brand condition, ops in their original order,
    // so `allow create, update` splits only when the brand tightens just one.
    const groups = [];
    for (const op of node.ops) {
      const condition = brandConditions.get(op) || null;
      const group = groups.find((entry) => entry.condition === condition);
      if (group) {
        group.ops.push(op);
      } else {
        groups.push({ condition, ops: [op] });
      }
    }

    inner += groups
      .map(({ condition, ops }) => `allow ${ops.join(', ')}: if ${node.condition}${condition ? ` && (${condition})` : ''};`)
      .join(`\n${node.indent}`);
  }

  // Everything the framework block has no opinion about, appended as written.
  const appended = [];
  for (const node of brandChildren) {
    if (node.type === 'allow') {
      const ops = node.ops.filter((op) => !frameworkOps.has(op));
      if (!ops.length) {
        continue;
      }
      for (const op of ops) {
        // EVERY framework op the brand op covers, in the framework's own
        // order: `write` beside `allow create, update` overlaps both, and a
        // remedy naming only the first would tighten half the rule.
        const overlapping = [...frameworkOps].filter((frameworkOp) => primitiveOps(frameworkOp).some((primitive) => primitiveOps(op).includes(primitive)));
        if (overlapping.length) {
          const named = overlapping.join(', ');
          warnings.push(`${BRAND_RULES_FILE}: in \`match ${brandNode.path}\`, your \`allow ${op}\` overlaps the framework's \`allow ${named}\` without being the same op — merging pairs ops by NAME, so Firestore ORs these two: your condition GRANTS ${op} on top of the framework rule instead of tightening it. Deliberate? Fine. Meant to tighten? Write \`allow ${named}\`.`);
        }
      }
      appended.push(`${childIndent}allow ${ops.join(', ')}: if ${node.condition};`);
      continue;
    }
    if (node.type === 'match' || node.type === 'function') {
      // A block of its own keeps the air it had in the brand file.
      appended.push(`\n${childIndent}${reindent(node.raw, node.indent, childIndent).trimStart()}`);
    }
  }

  if (appended.length) {
    inner = `${inner.replace(/\s+$/, '')}\n\n${childIndent}// ⤷ from your ${BRAND_RULES_FILE}\n${appended.join('\n')}\n${frameworkNode.indent}`;
  }

  // The text node ahead of this one already carries the block's indentation, so
  // the FIRST marker line opens flush and every line after it is indented. The
  // markers accumulate: a second brand block on this path adds its own, and the
  // artifact keeps a line per merge.
  const markers = [...frameworkNode.markers, `// ⤷ merged with your ${BRAND_RULES_FILE} \`match ${brandNode.path}\``];

  return {
    raw: `${markers.join(`\n${frameworkNode.indent}`)}\n${frameworkNode.indent}match ${frameworkNode.path} {${inner}}`,
    inner,
    markers,
  };
}

/**
 * An `allow` op in primitive terms (`write` → create/update/delete).
 * @param {string} op
 * @returns {string[]}
 */
function primitiveOps(op) {
  return OP_ALIASES[op] || [op];
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
    `//    1. YOUR rules           ./${BRAND_RULES_FILE}`,
    '//       ^ EDIT THAT FILE — everything a brand owns lives there.',
    '//    2. Framework rules      ./node_modules/@omega.js/backend/templates/firestore.framework.rules',
    '//       ^ ships inside @omega.js/backend; upgrade the package to change it.',
    '//',
    '//  A match block of yours whose path matches a framework block is MERGED into',
    '//  it (your condition ANDs onto the framework\'s) — look for the `⤷ merged`',
    '//  markers below to see what your file did to a framework rule.',
    '//',
    '//  Rebuilt by every `omega build` (and so by setup, emulator, serve, test and',
    '//  deploy). firebase.json points BOTH the emulator and `firebase deploy` at',
    '//  this file, and every edit made here is overwritten on the next build.',
    '// ============================================================================',
  ].join('\n');
}

/**
 * Compile the framework half + a brand half into one deployable ruleset.
 *
 * Pure string work — no disk writes, so the tests can compile any brand source
 * they like.
 *
 * An UNMIGRATED (legacy marker-block) source throws: its managed block still
 * carries the framework's own functions, so splicing it in would emit every one
 * of them twice — a ruleset Firestore refuses to load. There is no valid
 * artifact to produce from that input, so nothing pretends otherwise.
 * @param {object} options
 * @param {string} options.brandSource - The brand's whole firestore.rules.
 * @returns {{ compiled: string, merged: string[], warnings: string[] }}
 */
function compileRules(options) {
  if (isPreFamilyMarkerFile(options.brandSource)) {
    throw new Error(`${BRAND_RULES_FILE} still carries a pre-family marker ('{{ backend-manager }}' or a '///---...---///' block), which is not rules syntax — compiling it would splice that marker into the deployed ruleset as if it were one of your rules. Run \`${MARKER_MIGRATION_COMMAND}\` to convert it (your custom rules are kept).`);
  }

  if (isLegacyMarkerFile(options.brandSource)) {
    throw new Error(`${BRAND_RULES_FILE} still carries the legacy OMEGA Rules marker block, which redefines the framework's own functions — compiling it would emit a duplicate-function ruleset that cannot load. Run \`npx omega migrate:rules\` to migrate it (your custom rules are kept).`);
  }

  const framework = jetpack.read(FRAMEWORK_RULES_TEMPLATE);
  const brandNodes = parseNodes(extractDocumentsBody(options.brandSource, BRAND_RULES_FILE), BRAND_RULES_FILE);
  const frameworkNodes = parseNodes(extractDocumentsBody(framework, 'firestore.framework.rules'), 'firestore.framework.rules');

  const merged = [];
  const warnings = [];
  const frameworkBlocks = new Map();
  for (const node of frameworkNodes) {
    if (node.type === 'match') {
      // What a merge into this block accumulates: its marker lines, and the
      // name an error in its text should carry once it is no longer purely the
      // framework's.
      node.markers = [];
      node.label = 'firestore.framework.rules';
      frameworkBlocks.set(canonicalPath(node.path), node);
    }
  }

  let brandRendered = '';
  for (const node of brandNodes) {
    const target = node.type === 'match' ? frameworkBlocks.get(canonicalPath(node.path)) : null;
    if (!target) {
      brandRendered += node.raw;
      continue;
    }

    // Merged in place: a second brand block on the same path tightens what the
    // first one already produced, so the merged parts go back on the node as
    // they were built — the text is no longer safe to re-split on a brace.
    const rewritten = mergeMatchBlock(target, node, warnings);
    target.raw = rewritten.raw;
    target.inner = rewritten.inner;
    target.markers = rewritten.markers;
    target.label = `the merged \`match ${target.path}\` block (firestore.framework.rules + ${BRAND_RULES_FILE})`;
    merged.push(target.path);
  }

  const compiled = [
    compiledHeader(),
    'rules_version = \'2\';',
    'service cloud.firestore {',
    '  match /databases/{database}/documents {',
    '    // ─── Brand rules (from firestore.rules) ───────────────────────────────',
    collapseBlankRuns(trimBlankEdges(brandRendered)),
    '',
    '    // ─── Framework rules (@omega.js/backend) ──────────────────────────────',
    collapseBlankRuns(trimBlankEdges(frameworkNodes.map((node) => node.raw).join(''))),
    '  }',
    '}',
    '',
  ].join('\n');

  return { compiled, merged, warnings };
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
 * @param {string} options.projectDir - The target root.
 * @param {function} [options.onWarn] - Loud reporter (defaults to a yellow console line).
 * @returns {{ compiledPath: string, merged: string[], seededFallback: boolean, refused: boolean }}
 */
function compileFirestoreRules(options) {
  const projectDir = options.projectDir;
  const onWarn = options.onWarn || defaultWarn;
  const sourcePath = path.join(projectDir, BRAND_RULES_FILE);
  const compiledPath = path.join(projectDir, COMPILED_RULES_FILE);

  const seededFallback = !jetpack.exists(sourcePath);
  if (seededFallback) {
    onWarn(`No ${BRAND_RULES_FILE} at the target root — compiling the framework half against the shipped defaults. Any verb seeds your own.`);
  }

  const brandSource = seededFallback ? jetpack.read(BRAND_RULES_SEED) : jetpack.read(sourcePath);

  // Which command actually moves this tree forward: the target checks
  // (`omega test`) migrate a source whose brand already deploys the compiled
  // artifact, but a brand still pointing firebase.json at its own file has
  // deferred, and only the run-alone verb touches it
  // ([#522](https://github.com/Omega-JS-Stack/omega/issues/522)).
  const deferred = deferredRulesTarget({ projectDir });
  const nextStep = deferred ? RULES_MIGRATION_COMMAND : 'npx omega test';

  if (isPreFamilyMarkerFile(brandSource)) {
    onWarn(`${BRAND_RULES_FILE} still carries a pre-family marker ('{{ backend-manager }}' or a '///---...---///' block), which is not rules syntax — refusing to write a ${COMPILED_RULES_FILE} that carries that marker as if it were one of your rules. Run \`${MARKER_MIGRATION_COMMAND}\` to convert it (your custom rules are kept).`);

    return { compiledPath, merged: [], seededFallback, refused: true };
  }

  if (isLegacyMarkerFile(brandSource)) {
    onWarn(`${BRAND_RULES_FILE} still carries the legacy OMEGA Rules marker block, which redefines the framework's own functions — refusing to write a duplicate-function ${COMPILED_RULES_FILE} that cannot load. Run \`${nextStep}\` to migrate it (your custom rules are kept).`);

    return { compiledPath, merged: [], seededFallback, refused: true };
  }

  const { compiled, merged, warnings } = compileRules({ brandSource });

  for (const warning of warnings) {
    onWarn(warning);
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
    onWarn(`firebase.json points firestore.rules at "${target}" — it must be "${COMPILED_RULES_FILE}" (the compiled artifact) or the framework rules never load. Run \`${nextStep}\`.`);
  }

  return { compiledPath, merged, seededFallback, refused: false };
}

/**
 * Seed / migrate the brand's AUTHORED firestore.rules.
 *
 * All of it idempotent, and all of it setup's (never the build's — the build
 * writes dist/ only):
 *   - no file          → write the seed
 *   - pre-family       → REFUSED, untouched (only `omega migrate:markers` speaks it)
 *   - legacy markers   → extract the non-managed region into the new source ONCE
 *   - v2 hook era      → delete a hook still carrying its default body, KEEP a
 *                        customized one as an ordinary brand function, and
 *                        refresh a header that still documents the hook model
 * @param {object} options
 * @param {string} options.projectDir - The target root.
 * @returns {{ created: boolean, migrated: boolean, refused: boolean, strippedHooks: string[], keptHooks: string[] }}
 */
function ensureBrandRulesSource(options) {
  const projectDir = options.projectDir;
  const sourcePath = path.join(projectDir, BRAND_RULES_FILE);
  const seed = jetpack.read(BRAND_RULES_SEED);
  const result = { created: false, migrated: false, refused: false, strippedHooks: [], keptHooks: [] };

  let contents = jetpack.exists(sourcePath) ? jetpack.read(sourcePath) : '';

  if (!contents.trim()) {
    jetpack.write(sourcePath, seed);

    return { ...result, created: true };
  }

  // A PRE-FAMILY source is not a legacy-marker one and not a v2 one: nothing
  // below speaks `///---backend-manager---///` or `{{ backend-manager }}`, so
  // the hook-era pass would rename its helpers, report a MIGRATION, and leave
  // every pre-family marker sitting in the file. Refuse instead — the same
  // shape the build's refusal takes, and the caller names the run-alone verb
  // that does speak it ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
  if (isPreFamilyMarkerFile(contents)) {
    return { ...result, refused: true };
  }

  if (isLegacyMarkerFile(contents)) {
    contents = migrateLegacyMarkerFile(contents);
    result.migrated = true;
  }

  if (hasRetiredHookEra(contents)) {
    const retired = retireHooks(contents, seed);

    result.migrated = result.migrated || retired.contents !== contents;
    result.strippedHooks = retired.stripped;
    result.keptHooks = retired.kept;
    contents = retired.contents;
  }

  if (result.migrated) {
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
 * BEM's hand-written insertion placeholder, whitespace-tolerant exactly as BEM
 * matched it. Fresh regex per call — these are /g for the replace paths.
 * @returns {RegExp}
 */
function preFamilyPlaceholderRegex() {
  return /{{\s*?backend-manager\s*?}}/g;
}

/**
 * The pre-family managed BLOCK, open marker through end marker: BEM's own
 * `///---backend-manager---///` and the cp72-74 `///---omega---///` interim
 * flavor, which differ only in that word.
 * @returns {RegExp}
 */
function preFamilyBlockRegex() {
  return /\/\/\/---(?:backend-manager|omega)---\/\/\/[\s\S]*?\/\/\/---------end---------\/\/\//g;
}

/**
 * A PRE-FAMILY marker file — one the family grammar cannot see at all, so no
 * evergreen verb can converge it ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
 *
 * Both rules files ask here: firestore.rules and database.rules.json carried the
 * same two shapes (the placeholder, and the bracket block).
 * @param {string} contents
 * @returns {boolean}
 */
function isPreFamilyMarkerFile(contents) {
  return preFamilyPlaceholderRegex().test(contents) || preFamilyBlockRegex().test(contents);
}

/**
 * A v2 (hook-era) rules file: it still carries something the migration would
 * CHANGE — a strippable hook, a call to a helper v3 renamed, or a header that
 * still teaches a retired name.
 *
 * Only what the migration changes counts, so the question settles: a KEPT
 * (customized or still-called) hook is the brand's own function afterwards, and
 * asking about it forever would re-report and re-warn every setter-up. Narrow
 * on purpose too — a brand's own comment naming an old symbol elsewhere is the
 * brand's business.
 * @param {string} contents
 * @returns {boolean}
 */
function hasRetiredHookEra(contents) {
  if (Object.keys(RETIRED_HOOKS).some((hook) => findRetiredHook(contents, hook)?.strippable)) {
    return true;
  }

  if (Object.keys(RENAMED_HELPERS).some((name) => referencesName(contents, name))) {
    return true;
  }

  const header = leadingCommentBlock(contents);

  return !!header && RETIRED_NAMES.some((name) => new RegExp(`\\b${name}\\b`).test(contents.slice(0, header.end)));
}

/**
 * Does this brand source need setup to migrate it? The ONE place that question
 * is answered — setup's check and its fix both ask here.
 * @param {string} contents - The brand's whole firestore.rules.
 * @returns {boolean}
 */
function needsRulesMigration(contents) {
  return !contents.trim() || isPreFamilyMarkerFile(contents) || isLegacyMarkerFile(contents) || hasRetiredHookEra(contents);
}

/**
 * Convert a legacy marker-block file into the new source: drop the managed
 * block, keep everything the brand wrote, and land it in the seed's shape.
 * Runs ONCE — the result carries no markers.
 * @param {string} contents - The legacy file.
 * @returns {string} The new brand source.
 */
function migrateLegacyMarkerFile(contents) {
  return spliceIntoSeed(contents.replace(/\/\/ ========== OMEGA Rules \(v.*?\) ==========.*?\/\/ ========== End OMEGA Rules ==========/s, ''));
}

/**
 * Convert a PRE-FAMILY firestore.rules — a `///---backend-manager---///` /
 * `///---omega---///` managed block, or the bare `{{ backend-manager }}`
 * placeholder — into the new source, the same three steps
 * `migrateLegacyMarkerFile()` takes: only the markers stripped differ. Runs
 * ONCE ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
 * @param {string} contents - The pre-family file.
 * @returns {string} The new brand source.
 */
function migratePreFamilyMarkerFile(contents) {
  return spliceIntoSeed(contents
    .replace(preFamilyBlockRegex(), '')
    .replace(preFamilyPlaceholderRegex(), ''));
}

/**
 * The tail every rules-marker migration shares: take what the brand wrote out of
 * a now-markerless file and land it in the seed's example-rules slot.
 * @param {string} stripped - The file with its managed block/placeholder gone.
 * @returns {string} The new brand source.
 */
function spliceIntoSeed(stripped) {
  const seed = jetpack.read(BRAND_RULES_SEED);
  const custom = trimBlankEdges(extractDocumentsBody(stripped, BRAND_RULES_FILE));

  if (!seed.includes(SEED_RULES_PLACEHOLDER)) {
    // The placeholder is a literal block of templates/firestore.rules, in this
    // same package — drift here is a framework bug, never a consumer's.
    throw new Error(`templates/${BRAND_RULES_FILE}: the example-rules placeholder the migration replaces is gone`);
  }

  // Function replacement, never a replacement STRING: brand-authored rules are
  // arbitrary text, and `$$` / `$&` / `` $` `` / `$'` in a replacement string
  // are directives that would rewrite the brand's own bytes on the way in.
  return seed.replace(SEED_RULES_PLACEHOLDER, () => (custom.trim() ? custom : SEED_RULES_PLACEHOLDER));
}

/**
 * Retire the v2 hooks out of a brand source: a hook still carrying its shipped
 * default body is deleted outright, a customized one is KEPT as an ordinary
 * brand function (nothing calls it now, which is why the caller reports it),
 * and a header that still teaches the hook model is replaced with the seed's.
 * @param {string} contents - The brand's whole firestore.rules.
 * @param {string} seed - templates/firestore.rules.
 * @returns {{ contents: string, stripped: string[], kept: string[] }}
 */
function retireHooks(contents, seed) {
  const stripped = [];
  const kept = [];
  let output = contents;

  for (const hook of Object.keys(RETIRED_HOOKS)) {
    const found = findRetiredHook(output, hook);
    if (!found) {
      continue;
    }

    const { block, strippable } = found;
    if (strippable) {
      output = `${output.slice(0, block.start)}${output.slice(block.end)}`;
      stripped.push(hook);
    } else {
      // The brand's own code: keep the function, drop the doc comment that
      // describes a contract nothing honors any more.
      output = [
        output.slice(0, block.start),
        `${block.indent}// Kept from the retired \`${hook}()\` framework hook (rules v2): nothing\n`,
        `${block.indent}// calls it now — call it from your own match block, or delete it.\n`,
        output.slice(block.definitionStart, block.end),
        output.slice(block.end),
      ].join('');
      kept.push(hook);
    }
  }

  // Calls to the helpers v3 renamed — including from inside a hook body kept
  // above. A rules file that calls a function no half defines does not load.
  output = renameIdentifiers(output, RENAMED_HELPERS);

  // The hook-era section header, left dangling once its functions are gone.
  output = output.replace(/[^\S\n]*\/\/ ─+ Framework hooks ─+\n(?:[^\S\n]*\/\/[^\n]*\n)*/g, '');


  // The file's opening header is OURS (every era's seed shipped one). One that
  // still teaches names v3 retired is replaced wholesale with the current seed's.
  const header = leadingCommentBlock(output);
  const seedHeader = leadingCommentBlock(seed);
  if (header && seedHeader && RETIRED_NAMES.some((name) => new RegExp(`\\b${name}\\b`).test(output.slice(0, header.end)))) {
    output = `${seed.slice(0, seedHeader.end)}${output.slice(header.end)}`;
  }

  // Collapse what the removals left: a run of blank lines, and the blank line
  // a hook at the end of a block leaves in front of its closing brace.
  return { contents: collapseBlankRuns(output).replace(/\n[^\S\n]*\n([^\S\n]*\})/g, '\n$1'), stripped, kept };
}

/**
 * A retired hook as this file defines it, and whether the migration would DELETE
 * it outright. Strippable means the shipped default body AND nothing calling it:
 * a body the brand edited is its own work, and deleting a hook something still
 * calls would emit a ruleset Firestore cannot load. The ONE place that verdict
 * is reached — the migration acts on it, and `hasRetiredHookEra` asks it so the
 * check settles once every strippable hook is gone.
 * @param {string} source - The brand's whole firestore.rules.
 * @param {string} hook - A key of RETIRED_HOOKS.
 * @returns {?{ block: object, strippable: boolean }}
 */
function findRetiredHook(source, hook) {
  const block = findFunctionBlock(source, hook);
  if (!block) {
    return null;
  }

  const called = referencesName(`${source.slice(0, block.start)}${source.slice(block.end)}`, hook);

  return { block, strippable: !called && block.body.replace(/\s+/g, ' ').trim() === RETIRED_HOOKS[hook] };
}

/**
 * A function definition plus the contiguous `//` comment lines above it.
 * @param {string} source
 * @param {string} name
 * @returns {?{ start: number, definitionStart: number, end: number, body: string, indent: string }}
 */
function findFunctionBlock(source, name) {
  const match = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!match) {
    return null;
  }

  const open = match.index + match[0].length - 1;
  const close = findClosingBrace(source, open, BRAND_RULES_FILE);
  const definitionStart = source.lastIndexOf('\n', match.index) + 1;

  // Walk back over the comment lines introducing it, so a delete takes the
  // hook's docs with it.
  let start = definitionStart;
  while (start > 0) {
    const previousStart = source.lastIndexOf('\n', start - 2) + 1;
    if (!source.slice(previousStart, start - 1).trim().startsWith('//')) {
      break;
    }
    start = previousStart;
  }

  return {
    start,
    definitionStart,
    end: source[close + 1] === '\n' ? close + 2 : close + 1,
    body: source.slice(open + 1, close),
    indent: source.slice(definitionStart, match.index),
  };
}

/**
 * Is `name` named by the CODE (never by a comment or a string) in this text?
 * @param {string} source
 * @param {string} name
 * @returns {boolean}
 */
function referencesName(source, name) {
  let index = 0;

  while (index < source.length) {
    const skip = skipNonCode(source, index);
    if (skip !== -1) {
      index = skip;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (word) {
      if (word[0] === name) {
        return true;
      }
      index += word[0].length;
      continue;
    }

    index++;
  }

  return false;
}

/**
 * The file's opening `//` comment block, if it has one.
 * @param {string} source
 * @returns {?{ end: number }}
 */
function leadingCommentBlock(source) {
  const lines = source.split('\n');
  let end = 0;

  for (const line of lines) {
    if (!line.trim().startsWith('//')) {
      break;
    }
    end += line.length + 1;
  }

  return end ? { end } : null;
}

/**
 * Drop leading/trailing blank lines, keeping indentation on the rest.
 * @param {string} text
 * @returns {string}
 */
function trimBlankEdges(text) {
  return text.replace(/^(\s*\n)+/, '').replace(/(\n\s*)+$/, '');
}

/**
 * Collapse a run of blank lines (what removing a block leaves behind) to one.
 * @param {string} text
 * @returns {string}
 */
function collapseBlankRuns(text) {
  return text.replace(/\n[^\S\n]*\n(?:[^\S\n]*\n)+/g, '\n\n');
}

/**
 * Has this brand DEFERRED the compiled-rules migration?
 *
 * A brand whose firebase.json still names its own rules file deploys the brand
 * half alone — the legacy posture, deliberately kept. Migrating it flips what
 * the live project enforces (the framework half joins, and `allow write`
 * becomes `allow create, update`), so it is a one-time step a human runs alone,
 * never something another verb heals on the way to a deploy
 * ([#522](https://github.com/Omega-JS-Stack/omega/issues/522)).
 *
 * A target naming nothing, or naming a file that is not there, has deferred
 * nothing: that is a fresh brand, and setup seeds it as it always has.
 * @param {object} options
 * @param {string} options.projectDir - The target root.
 * @param {object} [options.firebaseJSON] - The parsed firebase.json (read from disk when omitted).
 * @returns {string|null} The deferred target firebase.json names, or null.
 */
function deferredRulesTarget(options) {
  const projectDir = options.projectDir;
  const firebaseJSON = options.firebaseJSON || jetpack.read(path.join(projectDir, 'firebase.json'), 'json');
  const target = firebaseJSON?.firestore?.rules;

  if (!target || target === COMPILED_RULES_FILE) {
    return null;
  }

  return jetpack.exists(path.join(projectDir, target)) === 'file' ? target : null;
}

/**
 * The deferral, as setup reports it: what was NOT done, what migrating would
 * change on the live project, and the one command that does it.
 * @param {string} target - The rules file firebase.json still names.
 * @returns {string[]} Pre-formatted lines.
 */
function rulesMigrationDeferralNotice(target) {
  return [
    `firebase.json still points firestore.rules at "${target}" — the compiled-rules migration is DEFERRED and nothing was changed.`,
    `Migrating rewrites your ${BRAND_RULES_FILE} and deploys ${COMPILED_RULES_FILE} (your rules + the framework half), which CHANGES LIVE POSTURE — a legacy \`allow write\` becomes \`allow create, update\`, so a client deleting its own doc flips allowed → denied.`,
    `Run it deliberately, on its own, once you have read the diff: ${RULES_MIGRATION_COMMAND}`,
  ];
}

/**
 * The pre-family deferral, as setup reports it: what was NOT done, and the one
 * verb that does it. The twin of `rulesMigrationDeferralNotice()` above, shared
 * by both rules checks so they defer in identical words
 * ([#40](https://github.com/Omega-JS-Stack/omega/issues/40)).
 * @param {string} fileName - The file carrying the pre-family marker.
 * @returns {string[]} Pre-formatted lines.
 */
function markerMigrationDeferralNotice(fileName) {
  return [
    `${fileName} still carries a pre-family marker ('{{ backend-manager }}' or a '///---...---///' block) — nothing here speaks it, so the file was left untouched.`,
    `Convert it once, on its own, then run this again: ${MARKER_MIGRATION_COMMAND}`,
  ];
}

module.exports = {
  RULES_VERSION,
  BRAND_RULES_FILE,
  BRAND_RULES_SEED,
  COMPILED_RULES_FILE,
  FRAMEWORK_RULES_TEMPLATE,
  MARKER_MIGRATION_COMMAND,
  RETIRED_NAMES,
  RULES_MIGRATION_COMMAND,
  compileRules,
  compileFirestoreRules,
  deferredRulesTarget,
  ensureBrandRulesSource,
  extractDocumentsBody,
  isPreFamilyMarkerFile,
  markerMigrationDeferralNotice,
  migratePreFamilyMarkerFile,
  preFamilyPlaceholderRegex,
  needsRulesMigration,
  rulesMigrationDeferralNotice,
};
