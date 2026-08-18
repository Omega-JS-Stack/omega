/**
 * The hard-to-forget enforcement behind #200: a config-time module may not
 * read the filesystem directly. Every read `configureOmega` performs goes
 * through @omega.js/devkit/reads, because reading through the helper IS the watch
 * registration — a direct fs/jetpack call is a capture the dev loop can never
 * invalidate, which is exactly the drift the hand list kept accumulating
 * (#139).
 *
 * Static by design: the guard greps the config-time modules, so it fails the
 * moment a conversion is reverted or a new direct read is added, without
 * needing a scenario that exposes the stale render.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const SRC = path.join(__dirname, '..', 'src');

// Read-shaped calls only — writes (mkdir/write/rm) capture nothing.
const DIRECT_READ = /\b(?:fs\.(?:readdirSync|readdir|readFileSync|readFile|existsSync|statSync|lstatSync)|jetpack\.(?:read|list|exists|find|inspect|inspectTree))\b/g;

// The modules `configureOmega` runs through. Exceptions are named here, not in
// the source: each one is a read that does NOT happen inside the config
// capture scope, with the lane it belongs to.
const CONFIG_TIME_MODULES = [
  {
    file: 'engine.js',
    // Both exceptions live inside configureOmega but run LATER — Eleventy
    // calls them per template, on the incremental lane the reset must not own.
    snippets: [
      'fs.readFileSync(path.resolve(inputPath)', // render time: a page's own frontmatter, re-parsed per template
      'fs.readFileSync(sidecarPath(inputPath)', // render time: a page's own sidecar data file, re-read per template (#269)
      'fileExists: (file) => fs.existsSync', // template time: the file_exists Liquid filter
    ],
  },
  { file: 'layers.js', snippets: [] },
  // The layered LAYOUTS: virtual mode bakes each winning file's content into
  // the config, so the read is a config dependency like any other (its dirs
  // ride collectLayered's walk — the helper keeps the rule uniform).
  { file: 'layouts.js', snippets: [] },
  {
    file: 'sections.js',
    // readInheritLanes/collectSectionAssets are the ASSET lane (its own
    // watcher); registerSectionTags resolves entries lazily at render time,
    // and its dirs are already recorded by buildSectionLibrary's walk.
    functions: ['readInheritLanes', 'collectSectionAssets', 'registerSectionTags'],
  },
  {
    file: 'sample-content.js',
    // reconcileSampleContent is the boot phase — it runs before Eleventy
    // exists, restart-expected. hasOwnContent is Lane B: it reads through the
    // helper too, inside a `rescan` capture.
    functions: ['reconcileSampleContent'],
  },
  // Lane B's scan (#200): converted whole, no exceptions — its dirs ride the
  // rescan lane, and a direct read there is a decision the dev loop can never
  // refresh.
  { file: 'consumer-scan.js', snippets: [] },
  // Lane B's owner: it only orchestrates captures (the devkit reads helper does the
  // reading), so nothing here may ever touch the filesystem itself.
  { file: 'decisions.js', snippets: [] },
  {
    file: 'limit-collections.js',
    // The ONE module that must keep reading directly: collectionDocuments
    // walks the brand's content dirs (_posts, _team, …) recursively, and the
    // helper would record them as config-RESET targets — every post edit
    // would rebuild the whole config, which is the exact opposite of what a
    // limited dev build is for. The sample is a boot-time choice; a brand
    // that adds a document restarts.
    functions: ['collectionDocuments'],
  },
];

const FIX = 'route it through @omega.js/devkit/reads (readdir/read/dirExists/fileExists) so the read registers its own watch target (#200)';

/**
 * The top-level function blocks of a module, in source order — enough to say
 * which function a match sits in (these modules declare every function at
 * column 0).
 */
function functionBlocks(source) {
  const blocks = [];
  const declaration = /^function (\w+)/gm;
  let match;
  while ((match = declaration.exec(source)) !== null) {
    const close = source.indexOf('\n}\n', match.index);
    blocks.push({ name: match[1], start: match.index, end: close === -1 ? source.length : close + 2 });
  }
  return blocks;
}

/** Every direct read in a module: { line, call, fn, text }. */
function directReads(source) {
  const blocks = functionBlocks(source);
  const found = [];
  let match;
  DIRECT_READ.lastIndex = 0;
  while ((match = DIRECT_READ.exec(source)) !== null) {
    const block = blocks.find((entry) => match.index >= entry.start && match.index < entry.end);
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const lineEnd = source.indexOf('\n', match.index);
    found.push({
      line: source.slice(0, match.index).split('\n').length,
      call: match[0],
      fn: block ? block.name : 'module scope',
      text: source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim(),
    });
  }
  return found;
}

for (const module of CONFIG_TIME_MODULES) {
  test(`${module.file} reads the filesystem only through the captured-read helper`, () => {
    const source = fs.readFileSync(path.join(SRC, module.file), 'utf8');
    const allowedFunctions = module.functions || [];
    const allowedSnippets = module.snippets || [];

    const offenders = directReads(source).filter((entry) => (
      !allowedFunctions.includes(entry.fn)
      && !allowedSnippets.some((snippet) => entry.text.includes(snippet))
    ));

    assert.deepEqual(offenders, [], offenders.map((entry) => (
      `src/${module.file}:${entry.line} (${entry.fn}) reads directly — ${entry.text} — ${FIX}`
    )).join('\n'));
  });
}

test('every guard exception still matches a read in its module', () => {
  for (const module of CONFIG_TIME_MODULES) {
    const source = fs.readFileSync(path.join(SRC, module.file), 'utf8');
    const reads = directReads(source);

    for (const fn of module.functions || []) {
      assert.ok(reads.some((entry) => entry.fn === fn),
        `src/${module.file}: ${fn} no longer reads directly — drop it from the guard's exceptions`);
    }
    for (const snippet of module.snippets || []) {
      assert.ok(reads.some((entry) => entry.text.includes(snippet)),
        `src/${module.file}: no read matches the exception "${snippet}" — drop or update it`);
    }
  }
});
