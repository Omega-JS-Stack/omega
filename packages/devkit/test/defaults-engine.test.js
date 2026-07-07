// Unit tests for src/defaults-engine.js — the shared defaults-scaffolding engine.
//
// Each test builds a defaults tree + consumer dir under .temp/ programmatically
// (no committed fixtures — trees are tiny and per-test isolation matters), runs
// applyDefaults, and asserts on the consumer tree + the returned summary.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const { applyDefaults, mergeJson5Defaults, renderTemplate } = require('../src/defaults-engine');
const { DEFAULT_MARKER, CUSTOM_MARKER } = require('../src/merge-line-files');

const TEMP = path.join(__dirname, '..', '.temp', `defaults-engine-${process.pid}`);
let caseIndex = 0;

// Fresh defaults/consumer pair per test.
function stage(defaultsFiles, consumerFiles) {
  const root = path.join(TEMP, `case-${caseIndex++}`);
  const defaultsDir = path.join(root, 'defaults');
  const outputDir = path.join(root, 'consumer');
  jetpack.dir(defaultsDir);
  jetpack.dir(outputDir);
  for (const [rel, contents] of Object.entries(defaultsFiles || {})) {
    jetpack.write(path.join(defaultsDir, rel), contents);
  }
  for (const [rel, contents] of Object.entries(consumerFiles || {})) {
    jetpack.write(path.join(outputDir, rel), contents);
  }
  return { defaultsDir, outputDir };
}

const quiet = { log: () => {}, warn: () => {}, error: () => {} };

test('throws without defaultsDir/outputDir', () => {
  assert.throws(() => applyDefaults({}), /defaultsDir and outputDir are required/);
});

test('fresh scaffold: copies files, strips `_.`, skips archive dirs and .DS_Store, .gitkeep creates dir only', () => {
  const { defaultsDir, outputDir } = stage({
    'README.md': 'readme',
    '_.gitignore': 'node_modules/',
    '_.env': `${DEFAULT_MARKER}\nKEY=""\n${CUSTOM_MARKER}\n`,
    '_mas/reference.plist': 'archive material',
    'src/.DS_Store': 'junk',
    'src/assets/.gitkeep': '',
    'test/_init.js': 'module.exports = {};',
  }, {});

  const result = applyDefaults({ defaultsDir, outputDir, logger: quiet });

  assert.equal(jetpack.read(path.join(outputDir, 'README.md')), 'readme');
  assert.equal(jetpack.read(path.join(outputDir, '.gitignore')), 'node_modules/');
  assert.ok(jetpack.exists(path.join(outputDir, '.env')));
  assert.equal(jetpack.exists(path.join(outputDir, '_mas')), false);
  assert.equal(jetpack.exists(path.join(outputDir, 'src', '.DS_Store')), false);
  assert.equal(jetpack.exists(path.join(outputDir, 'src', 'assets')), 'dir');
  assert.equal(jetpack.exists(path.join(outputDir, 'src', 'assets', '.gitkeep')), false);
  // `_`-prefixed FILENAMES are not archives — they ship.
  assert.equal(jetpack.read(path.join(outputDir, 'test', '_init.js')), 'module.exports = {};');
  assert.equal(result.merged.length, 0);
});

test('overwrite rules: default overwrites, `overwrite: false` preserves the consumer file', () => {
  const { defaultsDir, outputDir } = stage({
    'always.txt': 'framework',
    'docs/page.md': 'framework',
  }, {
    'always.txt': 'consumer',
    'docs/page.md': 'consumer',
  });

  applyDefaults({
    defaultsDir,
    outputDir,
    fileMap: { '**/*.md': { overwrite: false } },
    logger: quiet,
  });

  assert.equal(jetpack.read(path.join(outputDir, 'always.txt')), 'framework');
  assert.equal(jetpack.read(path.join(outputDir, 'docs', 'page.md')), 'consumer');
});

test('skip and overwrite accept functions receiving the item', () => {
  const { defaultsDir, outputDir } = stage({
    'pages/a.html': 'a',
    'pages/b.html': 'b',
  }, {});

  applyDefaults({
    defaultsDir,
    outputDir,
    fileMap: { 'pages/**/*': { skip: (item) => item.name === 'b.html' } },
    logger: quiet,
  });

  assert.equal(jetpack.read(path.join(outputDir, 'pages', 'a.html')), 'a');
  assert.equal(jetpack.exists(path.join(outputDir, 'pages', 'b.html')), false);
});

test('name and path rules rewrite the destination', () => {
  const { defaultsDir, outputDir } = stage({ 'tpl/file.txt': 'x' }, {});

  applyDefaults({
    defaultsDir,
    outputDir,
    fileMap: {
      'tpl/file.txt': {
        name: (item) => item.name.replace('file', 'renamed'),
        path: () => 'moved',
      },
    },
    logger: quiet,
  });

  assert.equal(jetpack.read(path.join(outputDir, 'moved', 'renamed.txt')), 'x');
});

test('template rule renders {{ key.path }}; unknown keys (GitHub ${{ }}) survive', () => {
  const { defaultsDir, outputDir } = stage({
    '.nvmrc': 'v{{ versions.node }}',
    'wf.yml': 'node: {{ versions.node }}\ntoken: ${{ secrets.GH_TOKEN }}',
  }, {});

  applyDefaults({
    defaultsDir,
    outputDir,
    fileMap: { '{.nvmrc,wf.yml}': { template: { versions: { node: '22' } } } },
    logger: quiet,
  });

  assert.equal(jetpack.read(path.join(outputDir, '.nvmrc')), 'v22');
  assert.equal(jetpack.read(path.join(outputDir, 'wf.yml')), 'node: 22\ntoken: ${{ secrets.GH_TOKEN }}');
});

test('mergeLines rule: consumer custom values survive, new framework keys arrive', () => {
  const { defaultsDir, outputDir } = stage({
    '_.env': `${DEFAULT_MARKER}\nGH_TOKEN=""\nNEW_KEY=""\n${CUSTOM_MARKER}\n`,
  }, {
    '.env': `${DEFAULT_MARKER}\nGH_TOKEN="mine"\n${CUSTOM_MARKER}\nCUSTOM="kept"\n`,
  });

  const result = applyDefaults({
    defaultsDir,
    outputDir,
    fileMap: { '_.env': { mergeLines: true } },
    logger: quiet,
  });

  const env = jetpack.read(path.join(outputDir, '.env'));
  assert.match(env, /GH_TOKEN="mine"/);
  assert.match(env, /NEW_KEY=""/);
  assert.match(env, /CUSTOM="kept"/);
  assert.deepEqual(result.merged, ['.env']);
});

test('merge rule (JSON5): consumer values + consumer-only keys survive, `default` sentinel replaced', () => {
  const { defaultsDir, outputDir } = stage({
    'config/app.json5': JSON5.stringify({ theme: { id: 'classy' }, port: 1000, fresh: true }, null, 2),
  }, {
    'config/app.json5': JSON5.stringify({ theme: { id: 'custom' }, port: 'default', consumerOnly: { nested: 1 } }, null, 2),
  });

  applyDefaults({
    defaultsDir,
    outputDir,
    fileMap: { 'config/app.json5': { merge: true } },
    logger: quiet,
  });

  const merged = JSON5.parse(jetpack.read(path.join(outputDir, 'config', 'app.json5')));
  assert.equal(merged.theme.id, 'custom');
  assert.equal(merged.port, 1000);
  assert.equal(merged.fresh, true);
  assert.deepEqual(merged.consumerOnly, { nested: 1 });
});

test('files subset (watch single-file mode) processes only the listed source', () => {
  const { defaultsDir, outputDir } = stage({ 'a.txt': 'a', 'b.txt': 'b' }, {});

  applyDefaults({
    defaultsDir,
    outputDir,
    files: [path.join(defaultsDir, 'a.txt')],
    logger: quiet,
  });

  assert.equal(jetpack.read(path.join(outputDir, 'a.txt')), 'a');
  assert.equal(jetpack.exists(path.join(outputDir, 'b.txt')), false);
});

test('global transform hook runs on text files, never on binaries', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
  const { defaultsDir, outputDir } = stage({ 'page.md': 'Hello [site.name]' }, {});
  jetpack.write(path.join(defaultsDir, 'img.png'), png);

  applyDefaults({
    defaultsDir,
    outputDir,
    transform: (contents) => contents.replace('[site.name]', 'Acme'),
    logger: quiet,
  });

  assert.equal(jetpack.read(path.join(outputDir, 'page.md')), 'Hello Acme');
  assert.deepEqual(jetpack.read(path.join(outputDir, 'img.png'), 'buffer'), png);
});

test('idempotency: a second run writes and merges nothing', () => {
  const { defaultsDir, outputDir } = stage({
    'a.txt': 'a',
    // Blank line before the Custom marker matters: the merge protocol normalizes
    // to that shape, so a template without it gets one merge-write before stabilizing.
    '_.env': `${DEFAULT_MARKER}\nKEY=""\n\n${CUSTOM_MARKER}\n`,
    'config/app.json5': JSON5.stringify({ x: 1 }, null, 2),
  }, {});
  const config = {
    defaultsDir,
    outputDir,
    fileMap: {
      '_.env': { mergeLines: true },
      'config/app.json5': { merge: true },
    },
    logger: quiet,
  };

  applyDefaults(config);
  const second = applyDefaults(config);

  assert.equal(second.written.length, 0);
  assert.equal(second.merged.length, 0);
});

test('mergeJson5Defaults and renderTemplate are exported for direct use', () => {
  assert.equal(typeof mergeJson5Defaults, 'function');
  assert.equal(renderTemplate('v{{ v.n }}', { v: { n: 1 } }), 'v1');
});
