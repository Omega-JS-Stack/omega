/**
 * Unit tests for src/preludes/docs-sync.js: before every verb, a brand whose
 * @omega.js/manager is a local checkout gets that manager's docs/ synced from
 * the monorepo's docs/, writing only what changed. A published manager, and an
 * invocation outside a brand, are left alone.
 *
 * Fixtures are a miniature monorepo whose packages/devkit links to the REAL
 * devkit, so the prelude runs the real docs lane.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const docsSync = require('../src/preludes/docs-sync.js');
const { PRELUDES } = require('../src/preludes/index.js');

const DEVKIT = path.join(__dirname, '..');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-docs-sync-'));
}

// A monorepo (docs/ + a manager package + the real devkit) and a brand whose
// node_modules/@omega.js/manager links into it.
function linkedBrand() {
  const root = tmpdir();
  const monorepo = path.join(root, 'omega');
  const manager = path.join(monorepo, 'packages', 'manager');
  fs.mkdirSync(path.join(monorepo, 'docs', 'shared'), { recursive: true });
  fs.mkdirSync(manager, { recursive: true });
  fs.writeFileSync(path.join(monorepo, 'package.json'), JSON.stringify({ name: 'omega' }));
  fs.writeFileSync(path.join(manager, 'package.json'), JSON.stringify({ name: '@omega.js/manager' }));
  fs.symlinkSync(DEVKIT, path.join(monorepo, 'packages', 'devkit'));
  fs.writeFileSync(path.join(monorepo, 'docs', 'omega.md'), '# the map\n');
  fs.writeFileSync(path.join(monorepo, 'docs', 'shared', 'config.md'), '# config\n');

  const brand = path.join(root, 'brand');
  fs.mkdirSync(path.join(brand, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(manager, path.join(brand, 'node_modules', '@omega.js', 'manager'));
  return { monorepo, manager, brand };
}

test('docs-sync: it is on the boot list for every verb', () => {
  assert.ok(PRELUDES.includes(docsSync));
  assert.equal(docsSync.verbs, 'all');
});

test('docs-sync: a linked manager is synced, and a re-run writes only what changed', () => {
  const { monorepo, manager, brand } = linkedBrand();
  const lines = [];
  const log = (line) => lines.push(line);

  assert.deepEqual(docsSync.run({ brandRoot: brand, log }).written.sort(), ['omega.md', 'shared/config.md']);
  assert.equal(fs.readFileSync(path.join(manager, 'docs', 'omega.md'), 'utf8'), '# the map\n');
  assert.equal(lines.length, 1, 'a sync that wrote something says so in one line');

  const untouched = path.join(manager, 'docs', 'shared', 'config.md');
  const past = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(untouched, past, past);
  assert.deepEqual(docsSync.run({ brandRoot: brand, log }), { synced: true, written: [], removed: [] });
  assert.equal(lines.length, 1, 'a sync with nothing to do is silent');

  fs.writeFileSync(path.join(monorepo, 'docs', 'omega.md'), '# the map v2\n');
  assert.deepEqual(docsSync.run({ brandRoot: brand, log }).written, ['omega.md']);
  assert.equal(fs.statSync(untouched).mtime.getTime(), past.getTime(), 'the unchanged file is untouched');
});

test('docs-sync: a published manager and a run outside a brand are left alone', () => {
  const brand = tmpdir();
  const manager = path.join(brand, 'node_modules', '@omega.js', 'manager');
  fs.mkdirSync(path.join(manager, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(manager, 'package.json'), JSON.stringify({ name: '@omega.js/manager' }));
  fs.writeFileSync(path.join(manager, 'docs', 'omega.md'), '# shipped\n');

  assert.deepEqual(docsSync.run({ brandRoot: brand }), { synced: false, reason: 'published' });
  assert.equal(fs.readFileSync(path.join(manager, 'docs', 'omega.md'), 'utf8'), '# shipped\n');
  assert.deepEqual(docsSync.run({ brandRoot: null }), { synced: false, reason: 'no-brand' });
  assert.deepEqual(docsSync.run({ brandRoot: tmpdir() }), { synced: false, reason: 'no-manager' });
});
