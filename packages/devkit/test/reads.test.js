/**
 * reads.js — the captured-read helper (#200 Lane A). Reading through it IS
 * the watch registration, so this suite pins the RECORDING rules that make
 * that safe: directory granularity, a miss still arms, realpath outside the
 * consumer dir, and one scope per config build.
 *
 * Real files and real symlinks — the rules are filesystem facts, not shapes.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const reads = require('../src/reads.js');

// A fixture tree ({ 'relative/path': contents }) plus its realpath root.
function fixture(t, files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-reads-')));
  t.after(() => {
    reads.closeScope();
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

const dirsOf = (targets) => targets.map((target) => target.dir).sort();

test('a readdir records the directory it read', (t) => {
  const root = fixture(t, { 'src/_includes/nav.json': '{}' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  assert.deepEqual(reads.readdir(path.join(root, 'src', '_includes')), ['nav.json']);
  assert.deepEqual(reads.recordedTargets(), [{ dir: path.join(root, 'src', '_includes'), kind: 'reset' }]);
});

test('a file read records its directory, never the file', (t) => {
  const root = fixture(t, { 'src/_includes/deep/nav.json': '{ "label": "hi" }' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  assert.equal(reads.read(path.join(root, 'src', '_includes', 'deep', 'nav.json')), '{ "label": "hi" }');
  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'src', '_includes', 'deep')]);
});

test('a probe of a missing directory still arms the watch', (t) => {
  const root = fixture(t, { 'src/pages/index.html': 'page' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  assert.equal(reads.dirExists(path.join(root, 'src', '_includes')), false);
  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'src', '_includes')],
    'a brand may author the dir mid-session — the reset must already be armed');
});

test('a file probe records the directory that would hold it', (t) => {
  const root = fixture(t, { 'src/_sections/toy/section.html': 'toy' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  assert.equal(reads.fileExists(path.join(root, 'src', '_sections', 'toy', 'section.html')), true);
  assert.equal(reads.fileExists(path.join(root, 'src', '_sections', 'toy', 'section.json5')), false);
  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'src', '_sections', 'toy')],
    'both probes are the same directory — one target');
});

test('the union is deduped across reads and probes', (t) => {
  const root = fixture(t, { 'src/_layouts/a.html': 'a', 'src/_layouts/b.html': 'b' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  reads.dirExists(path.join(root, 'src', '_layouts'));
  reads.readdir(path.join(root, 'src', '_layouts'));
  reads.read(path.join(root, 'src', '_layouts', 'a.html'));
  reads.read(path.join(root, 'src', '_layouts', 'b.html'));

  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'src', '_layouts')]);
});

test('a path outside the consumer dir is recorded realpath-resolved', (t) => {
  const root = fixture(t, { 'packaged/core/_layouts/core.html': 'core', 'src/pages/index.html': 'page' });
  // The linked-brand shape: node_modules sits at the TARGET root, beside src/
  const linked = path.join(root, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(path.join(root, 'packaged'), linked);
  reads.openScope({ consumerDir: path.join(root, 'src') });

  reads.readdir(path.join(linked, 'core', '_layouts'));

  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'packaged', 'core', '_layouts')],
    'Eleventy\'s watcher ignores node_modules wholesale — the resolved path sidesteps it (#134)');
});

test('a MISSING path outside the consumer dir resolves through its nearest existing ancestor', (t) => {
  const root = fixture(t, { 'packaged/core/_layouts/core.html': 'core', 'src/pages/index.html': 'page' });
  const linked = path.join(root, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(path.join(root, 'packaged'), linked);
  reads.openScope({ consumerDir: path.join(root, 'src') });

  // A packaged dir this version does not ship yet (the next one might):
  // realpath has nothing to resolve, but the SYMLINK on the way to it is
  // exactly what Eleventy's watcher refuses to look through.
  reads.dirExists(path.join(linked, 'defaults', 'showcase'));

  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'packaged', 'defaults', 'showcase')],
    'the node_modules form would arm a path Eleventy ignores wholesale (#134)');
});

test('a path inside the consumer dir is recorded as read', (t) => {
  const root = fixture(t, { 'src/_includes/nav.json': '{}' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  reads.readdir(path.join(root, 'src', '_includes'));

  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'src', '_includes')]);
});

test('reads outside a scope record nothing', (t) => {
  const root = fixture(t, { 'src/_includes/nav.json': '{}' });

  assert.deepEqual(reads.readdir(path.join(root, 'src', '_includes')), ['nav.json'],
    'the boot phase and omega build read through the helper too — recording is what goes away');
  assert.deepEqual(reads.recordedTargets(), []);
});

test('each scope records only its own reads', (t) => {
  const root = fixture(t, { 'src/_includes/nav.json': '{}', 'src/_layouts/toy.html': 'toy' });

  reads.openScope({ consumerDir: path.join(root, 'src') });
  reads.readdir(path.join(root, 'src', '_includes'));
  const first = reads.closeScope();

  reads.openScope({ consumerDir: path.join(root, 'src') });
  reads.readdir(path.join(root, 'src', '_layouts'));
  const second = reads.closeScope();

  assert.deepEqual(dirsOf(first), [path.join(root, 'src', '_includes')]);
  assert.deepEqual(dirsOf(second), [path.join(root, 'src', '_layouts')]);
  assert.deepEqual(reads.recordedTargets(), [], 'a closed scope records nothing more');
});

test('the armed handler receives the union when the scope closes', (t) => {
  const root = fixture(t, { 'src/_includes/nav.json': '{}' });
  const handled = [];

  reads.onNextScope((targets) => handled.push(targets));
  reads.openScope({ consumerDir: path.join(root, 'src') });
  reads.readdir(path.join(root, 'src', '_includes'));
  assert.deepEqual(handled, [], 'the union is only complete once the scope closes');
  reads.closeScope();

  assert.equal(handled.length, 1);
  assert.deepEqual(dirsOf(handled[0]), [path.join(root, 'src', '_includes')]);

  // Armed for ONE scope: the next config build arms its own handler.
  reads.openScope({ consumerDir: path.join(root, 'src') });
  reads.readdir(path.join(root, 'src', '_includes'));
  reads.closeScope();
  assert.equal(handled.length, 1);
});

// ---- Lane B: the rescan kind (#200)

test('a rescan capture records its dirs as rescan, never as reset', (t) => {
  const root = fixture(t, { 'src/pages/index.html': 'page', 'src/_includes/nav.json': '{}' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  reads.readdir(path.join(root, 'src', '_includes'));
  reads.rescan(() => reads.readdir(path.join(root, 'src', 'pages')));

  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'src', '_includes')],
    'a rescan dir on the reset lane would make every page edit rebuild the config');
  assert.deepEqual(dirsOf(reads.rescanTargets()), [path.join(root, 'src', 'pages')]);
});

test('a rescan target re-runs its own capture', (t) => {
  const root = fixture(t, { 'src/pages/index.html': 'page' });
  reads.openScope({ consumerDir: path.join(root, 'src') });
  const seen = [];

  reads.rescan(() => seen.push(reads.readdir(path.join(root, 'src', 'pages')).length));
  assert.deepEqual(seen, [1], 'the capture runs immediately — the recording is its side effect');

  fs.writeFileSync(path.join(root, 'src', 'pages', 'about.html'), 'page');
  reads.rescanTargets()[0].rerun();
  assert.deepEqual(seen, [1, 2], 'the re-run reads the CURRENT filesystem, not the captured one');
});

test('reads outside the capture go back to the reset lane', (t) => {
  const root = fixture(t, { 'src/pages/index.html': 'page', 'src/_layouts/toy.html': 'toy' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  reads.rescan(() => reads.readdir(path.join(root, 'src', 'pages')));
  reads.readdir(path.join(root, 'src', '_layouts'));

  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'src', '_layouts')]);
  assert.deepEqual(dirsOf(reads.rescanTargets()), [path.join(root, 'src', 'pages')]);
});

test('a dir read by both lanes stays a reset target', (t) => {
  const root = fixture(t, { 'src/_layouts/toy.html': 'toy' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  reads.rescan(() => reads.readdir(path.join(root, 'src', '_layouts')));
  reads.readdir(path.join(root, 'src', '_layouts'));

  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'src', '_layouts')],
    'the config itself depends on the dir — the reset is the stronger answer and covers the rescan too');
  assert.deepEqual(reads.rescanTargets(), []);
});

test('a rescan probe of a missing dir still arms', (t) => {
  const root = fixture(t, { 'src/pages/index.html': 'page' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  reads.rescan(() => reads.dirExists(path.join(root, 'src', '_posts')));

  assert.deepEqual(dirsOf(reads.rescanTargets()), [path.join(root, 'src', '_posts')],
    'the first real post creates the dir — the rescan must already be armed');
});

test('the closing scope hands the rescan union to the armed handler too', (t) => {
  const root = fixture(t, { 'src/pages/index.html': 'page', 'src/_layouts/toy.html': 'toy' });
  const handled = [];

  reads.onNextScope((targets, rescans) => handled.push({ targets, rescans }));
  reads.openScope({ consumerDir: path.join(root, 'src') });
  reads.readdir(path.join(root, 'src', '_layouts'));
  reads.rescan(() => reads.readdir(path.join(root, 'src', 'pages')));
  reads.closeScope();

  assert.deepEqual(dirsOf(handled[0].targets), [path.join(root, 'src', '_layouts')]);
  assert.deepEqual(dirsOf(handled[0].rescans), [path.join(root, 'src', 'pages')]);
});

// ---- Containment pruning (#200 Lane B)

test('a recorded dir covered by a recorded ancestor is pruned', (t) => {
  const root = fixture(t, { 'src/_sections/toy/section.html': 'toy', 'src/_sections/deep/nested/section.html': 'deep' });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  reads.dirExists(path.join(root, 'src', '_sections'));
  reads.fileExists(path.join(root, 'src', '_sections', 'toy', 'section.html'));
  reads.fileExists(path.join(root, 'src', '_sections', 'deep', 'nested', 'section.html'));

  assert.deepEqual(dirsOf(reads.recordedTargets()), [path.join(root, 'src', '_sections')],
    'a watch target is recursive — a recorded descendant is the same target twice');
});

test('disjoint dirs are never pruned', (t) => {
  const root = fixture(t, {
    'src/_layouts/toy.html': 'toy',
    'src/_includes/nav.json': '{}',
    // The name-prefix trap: `_sections-extra` STARTS WITH `_sections`, so a
    // containment test that compares strings without the separator swallows a
    // sibling that shares a prefix — and that dir loses its watcher.
    'src/_sections/toy/section.html': 'toy',
    'src/_sections-extra/toy/section.html': 'extra',
  });
  reads.openScope({ consumerDir: path.join(root, 'src') });

  reads.readdir(path.join(root, 'src', '_layouts'));
  reads.readdir(path.join(root, 'src', '_includes'));
  reads.readdir(path.join(root, 'src', '_sections'));
  reads.readdir(path.join(root, 'src', '_sections-extra'));

  assert.deepEqual(dirsOf(reads.recordedTargets()), [
    path.join(root, 'src', '_includes'),
    path.join(root, 'src', '_layouts'),
    path.join(root, 'src', '_sections'),
    path.join(root, 'src', '_sections-extra'),
  ], 'no dir contains another — pruning must not swallow a sibling, prefix or not');
});

test('pruning keeps every scan behind the surviving rescan target', (t) => {
  const root = fixture(t, { 'src/pages/index.html': 'page', 'src/pages/deep/about.html': 'page' });
  reads.openScope({ consumerDir: path.join(root, 'src') });
  const seen = [];

  reads.rescan(() => {
    reads.readdir(path.join(root, 'src', 'pages'));
    seen.push('outer');
  });
  reads.rescan(() => {
    reads.read(path.join(root, 'src', 'pages', 'deep', 'about.html'));
    seen.push('inner');
  });

  const targets = reads.rescanTargets();
  assert.deepEqual(dirsOf(targets), [path.join(root, 'src', 'pages')], 'pages/deep is covered by pages');
  targets[0].rerun();
  assert.deepEqual(seen, ['outer', 'inner', 'outer', 'inner'],
    'the pruned dir\'s capture re-runs through the target that swallowed it');
});
