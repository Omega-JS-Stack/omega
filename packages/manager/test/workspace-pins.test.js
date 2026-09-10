/**
 * Pin-writer tests (#794) — the scaffold writes EXACT `@omega.js/*` pins into
 * a brand: the manager's own version at the brand root, each target's
 * framework at the same number. A caret would let one target float ahead
 * alone; exact means only `omega update` moves anything, and it moves every
 * target together. The local era's `file:` specs are never touched, and a
 * rerun over an already-pinned brand changes nothing.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildScaffoldPlan, applyScaffoldPlan } = require('../src/lib/scaffold.js');

const MANAGER_VERSION = require('../package.json').version;

const ANSWERS = {
  id: 'pinbrand',
  name: 'Pin Brand',
  url: 'https://pinbrand.test',
  email: 'hi@pinbrand.test',
  targets: ['web', 'backend', 'desktop'],
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pins-'));
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('pin writer: the brand root pins @omega.js/manager at the manager\'s own version, exactly', () => {
  const root = tempDir();
  applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

  const pkg = readJson(path.join(root, 'package.json'));
  assert.deepEqual(pkg.devDependencies, { '@omega.js/manager': MANAGER_VERSION });
  assert.match(pkg.devDependencies['@omega.js/manager'], /^\d+\.\d+\.\d+/, 'a version, never a range');
});

test('pin writer: every target pins its framework at the same version — no caret, no star', () => {
  const root = tempDir();
  applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

  // The backend's framework is a RUNTIME dep (the stage derives dist/package.json
  // from it); every other target declares its framework as a devDependency
  assert.deepEqual(readJson(path.join(root, 'targets', 'website', 'package.json')).devDependencies, { '@omega.js/web': MANAGER_VERSION });
  assert.deepEqual(readJson(path.join(root, 'targets', 'desktop', 'package.json')).devDependencies, { '@omega.js/desktop': MANAGER_VERSION });
  assert.deepEqual(readJson(path.join(root, 'targets', 'backend', 'package.json')).dependencies, { '@omega.js/backend': MANAGER_VERSION });

  for (const file of ['package.json', 'targets/website/package.json', 'targets/backend/package.json', 'targets/desktop/package.json']) {
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/"@omega\.js\/[^"]+": "[\^~*]/.test(raw), `${file} carries a range instead of a pin`);
  }
});

test('pin writer: a `file:` spec already present is left untouched (the local era)', () => {
  const root = tempDir();
  const linkedRoot = '{\n  "name": "pinbrand",\n  "private": true,\n  "workspaces": ["targets/*"],\n  "devDependencies": { "@omega.js/manager": "file:../omega/packages/manager" }\n}\n';
  const linkedTarget = '{\n  "name": "pinbrand-website",\n  "devDependencies": { "@omega.js/web": "file:../../../omega/packages/web" }\n}\n';
  fs.writeFileSync(path.join(root, 'package.json'), linkedRoot);
  fs.mkdirSync(path.join(root, 'targets', 'website'), { recursive: true });
  fs.writeFileSync(path.join(root, 'targets', 'website', 'package.json'), linkedTarget);

  applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), linkedRoot);
  assert.equal(fs.readFileSync(path.join(root, 'targets', 'website', 'package.json'), 'utf8'), linkedTarget);
});

test('pin writer: idempotent — a rerun over an already-pinned brand writes nothing', () => {
  const root = tempDir();
  applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

  const files = ['package.json', 'targets/website/package.json', 'targets/backend/package.json', 'targets/desktop/package.json'];
  const before = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8'));

  const rerun = applyScaffoldPlan(root, buildScaffoldPlan(ANSWERS));

  assert.equal(rerun.created.length, 0, 'nothing is rewritten on a converged brand');
  files.forEach((file, i) => {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), before[i], `${file} changed on a rerun`);
  });
});
