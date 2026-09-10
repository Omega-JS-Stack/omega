/**
 * paths.js — the packaged content locations the engine and build entry
 * points default to, and the @omega.js/client entry resolution the esbuild
 * alias points at. Every path must exist IN the package (a published tarball
 * ships them under `files`), and the client resolution must fail with the
 * reinstall instruction rather than a bare MODULE_NOT_FOUND.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const { PATHS, resolveClientEntry } = require('../src/paths.js');

const PKG = path.resolve(__dirname, '..');

test('PATHS points at the packaged dirs, all of which exist', () => {
  assert.deepStrictEqual(PATHS, {
    themes: path.join(PKG, 'themes'),
    core: path.join(PKG, 'core'),
    defaults: path.join(PKG, 'defaults'),
    scaffold: path.join(PKG, 'scaffold'),
    runtime: path.join(PKG, 'runtime'),
    translations: path.join(PKG, 'translations'),
  });

  for (const [name, dir] of Object.entries(PATHS)) {
    assert.ok(fs.existsSync(dir), `${name} dir ships in the package`);
    assert.ok(fs.statSync(dir).isDirectory(), `${name} is a directory`);
  }
});

test('every packaged dir is declared in package.json files — a tarball must carry them', () => {
  const files = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).files;

  for (const name of Object.keys(PATHS)) {
    assert.ok(files.includes(`${name}/`), `${name}/ is published`);
  }
});

test('resolveClientEntry resolves the @omega.js/client entry module', () => {
  const entry = resolveClientEntry();

  assert.strictEqual(path.isAbsolute(entry), true);
  assert.strictEqual(fs.existsSync(entry), true);
  assert.strictEqual(entry, require.resolve('@omega.js/client'));
});

test('an unresolvable client tells the consumer to reinstall, not MODULE_NOT_FOUND', (t) => {
  // Prove the catch branch against the REAL resolver: the module runs from a
  // temp dir outside any node_modules tree, so @omega.js/client genuinely
  // cannot resolve — the missing-install condition, not a stubbed one.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-paths-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(PKG, 'src', 'paths.js'), path.join(dir, 'paths.js'));

  const result = spawnSync(process.execPath, [
    '-e',
    `require(${JSON.stringify(path.join(dir, 'paths.js'))}).resolveClientEntry()`,
  ], { cwd: dir, encoding: 'utf8' });

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /reinstall @omega\.js\/web \(npm install\) and retry/);
  assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND/);
});
