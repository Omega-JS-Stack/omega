/**
 * release-lockstep tests: the family releases on ONE version. The root
 * package.json, every publishable and the Claude plugin's manifest carry the
 * same number, set by hand in the `chore(release): <x.y.z>` commit: the plugin
 * moves only when its version does. The list of publishables is
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

const PLUGIN_MANIFEST = path.join('agent-plugins', 'claude', '.claude-plugin', 'plugin.json');

// A throwaway tree with the root, every publishable and the plugin on `version`.
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
  writePlugin(root, version);
  return root;
}

function writePlugin(root, version) {
  fs.mkdirSync(path.dirname(path.join(root, PLUGIN_MANIFEST)), { recursive: true });
  fs.writeFileSync(path.join(root, PLUGIN_MANIFEST), JSON.stringify({ name: 'omega', description: 'OMEGA', version }));
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

test('case 14: fails when the plugin manifest is off the family version, naming both', () => {
  const root = familyTree('1.2.3');
  writePlugin(root, '0.1.0');

  const verdict = checkLockstepVersions(root);
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /0\.1\.0/, 'names the plugin version');
  assert.match(verdict.detail, /1\.2\.3/, 'names the family version');
  assert.match(verdict.detail, /plugin/i, 'says which file is off');
  fs.rmSync(root, { recursive: true });
});

test('lockstep: the real tree is on one version', () => {
  const verdict = checkLockstepVersions();
  assert.equal(verdict.ok, true, `the family is not on one version: ${verdict.detail}`);
});
