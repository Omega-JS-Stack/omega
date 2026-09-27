/**
 * migrateTarget: the web leg of the brand root's `omega migrate`, the report
 * as `{ due, changed, errors }` lines. Report mode writes nothing, `execute`
 * writes, and what only a human can port stays due either way.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { migrateTarget } = require('../src/migrate/index.js');
const { stageLegacyConsumer } = require('./lib/migrate-fixtures.js');

test('migrateTarget: report mode lists every pending legacy shape as a due line and writes nothing (#885)', () => {
  const root = stageLegacyConsumer();
  try {
    const result = migrateTarget(root);

    assert.deepStrictEqual(result.changed, [], 'report mode changes nothing');
    assert.deepStrictEqual(result.errors, []);
    const due = result.due.join('\n');
    assert.match(due, /convert src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into config\/omega\.json5/, 'the config conversion');
    assert.match(due, /rewrite src\/pages\/index\.html: /, 'a codemod file, with its rules');
    assert.match(due, /^remove Gemfile$/m, 'a legacy file');
    assert.match(due, /src\/_layouts\/custom\.html:6: /, 'a lint finding, by file and line');

    assert.ok(!fs.existsSync(path.join(root, 'config', 'omega.json5')), 'no config written');
    assert.ok(fs.existsSync(path.join(root, 'Gemfile')), 'Gemfile untouched');
    assert.ok(fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8').includes('page.resolved'), 'templates untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migrateTarget --execute converts and names what it wrote; a second run changes nothing (#885)', () => {
  const root = stageLegacyConsumer();
  try {
    const first = migrateTarget(root, { execute: true });

    assert.deepStrictEqual(first.errors, []);
    const changed = first.changed.join('\n');
    assert.match(changed, /converted src\/_config\.yml \+ config\/ultimate-jekyll-manager\.json into config\/omega\.json5/);
    assert.match(changed, /rewrote src\/pages\/index\.html: /);
    assert.match(changed, /^removed Gemfile$/m);
    assert.ok(fs.existsSync(path.join(root, 'config', 'omega.json5')), 'config written');
    assert.ok(!fs.existsSync(path.join(root, 'Gemfile')), 'Gemfile removed');
    assert.ok(first.due.some((line) => /^src\/_layouts\/custom\.html:\d+: Jekyll-only tag/.test(line)), 'what only a human can port stays due after the write');

    const second = migrateTarget(root, { execute: true });
    assert.deepStrictEqual(second.changed, [], 'a converted target has nothing left to write');
    assert.deepStrictEqual(second.errors, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migrateTarget: the by-hand findings are due lines, each naming its file and fix (#885)', () => {
  const root = stageLegacyConsumer();
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'legacy-site', dependencies: {} }, null, 2));
    fs.mkdirSync(path.join(root, 'src', 'assets', 'js', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'assets', 'js', 'lib', 'prompt.js'), "function build() {\n  const jetpack = require('fs-jetpack');\n  return jetpack;\n}\n");
    fs.mkdirSync(path.join(root, 'test', 'build'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test', 'build', 'xp-curve.js'), 'module.exports = {};\n');
    fs.mkdirSync(path.join(root, 'src', 'pages', 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'pages', 'dashboard', 'new.md'), '---\nlayout: page\nasset_path: dashboard/edit\n---\n');

    const due = migrateTarget(root).due.join('\n');

    assert.match(due, /^src\/assets\/js\/lib\/prompt\.js:2: `fs-jetpack` .*npm install fs-jetpack/m, 'an undeclared require, with the dependency to add and never an install');
    assert.match(due, /^test\/build\/xp-curve\.js: /m, 'a legacy harness file `omega test` never discovers');
    assert.match(due, /sitemap\.xml shrinks/, 'the conversion note a brand changelog records');
    assert.match(due, /^src\/pages\/dashboard\/new\.md:3: `asset_path` is DEAD/m, 'the dead frontmatter key, by file and line');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migrateTarget: a tree with nothing to convert from is an error line, never a clean report (#885)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-target-empty-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    const result = migrateTarget(root);
    assert.ok(result.errors.some((line) => line.includes('no legacy configs found')), JSON.stringify(result.errors));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
