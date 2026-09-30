/**
 * release-lockstep tests: the family releases on ONE version. The root
 * package.json and every publishable carry the same number, set by hand in
 * the `chore(release): <x.y.z>` commit. The list of publishables is
 * release-check's `PUBLISHABLES`, never a second copy here.
 *
 * Run: node --test scripts/release-lockstep.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PUBLISHABLES, checkLockstepVersions } = require('./release-check.js');

// A throwaway tree with the root and every publishable on `version`.
function familyTree(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-lockstep-'));
  const write = (dir, name) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  };
  write(root, 'omega');
  for (const name of PUBLISHABLES) {
    write(path.join(root, 'packages', name), `@omega.js/${name}`);
  }
  return root;
}

test('lockstep: passes when the root and every publishable share one version', () => {
  const root = familyTree('1.2.3');
  assert.deepEqual(checkLockstepVersions(root), { ok: true, detail: '1.2.3' });
  fs.rmSync(root, { recursive: true });
});

test('lockstep: fails when one publishable is off the root version', () => {
  const root = familyTree('1.2.3');
  const file = path.join(root, 'packages', 'web', 'package.json');
  fs.writeFileSync(file, JSON.stringify({ name: '@omega.js/web', version: '1.2.2' }));

  const verdict = checkLockstepVersions(root);
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /web 1\.2\.2/);
  fs.rmSync(root, { recursive: true });
});

test('lockstep: fails when only the root was bumped', () => {
  const root = familyTree('1.2.3');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'omega', version: '1.3.0' }));

  assert.equal(checkLockstepVersions(root).ok, false);
  fs.rmSync(root, { recursive: true });
});

test('lockstep: the real tree is on one version', () => {
  const verdict = checkLockstepVersions();
  assert.equal(verdict.ok, true, `the family is not on one version: ${verdict.detail}`);
});
