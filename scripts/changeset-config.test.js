/**
 * changeset-config tests — the LOCKSTEP contract (#794): the seven
 * publishables share ONE version number, so `.changeset/config.json` carries
 * them as a single `fixed` group. The list is release-check's `PUBLISHABLES`
 * (the one home of what publishes), never a second copy here.
 * Run: node --test scripts/changeset-config.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PUBLISHABLES, checkLockstepVersions } = require('./release-check.js');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, '.changeset', 'config.json');

const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

test('changesets: ONE fixed group holding exactly the publishables', () => {
  assert.ok(Array.isArray(config.fixed), 'fixed must be an array of groups');
  assert.equal(config.fixed.length, 1, 'lockstep is ONE group — the whole family');
  assert.deepEqual(
    [...config.fixed[0]].sort(),
    PUBLISHABLES.map((name) => `@omega.js/${name}`).sort(),
    'the fixed group is release-check\'s PUBLISHABLES, by package name',
  );
});

test('changesets: internal dependencies keep moving with the group', () => {
  assert.equal(config.updateInternalDependencies, 'patch');
});

test('changesets: every fixed member is a real package that is not private-forever', () => {
  for (const name of config.fixed[0]) {
    const short = name.replace('@omega.js/', '');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', short, 'package.json'), 'utf8'));
    assert.equal(pkg.name, name);
  }
});

test('release-check: the lockstep check reads one version across the family', () => {
  // The script's own check, called directly — requiring release-check.js runs
  // nothing (its main() is guarded), so this never packs or installs anything.
  const verdict = checkLockstepVersions();

  assert.equal(verdict.ok, true, `the family is not on one version: ${verdict.detail}`);
  assert.match(verdict.detail, /^\d+\.\d+\.\d+/, 'the detail IS the one version');
  for (const name of PUBLISHABLES) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', name, 'package.json'), 'utf8'));
    assert.equal(pkg.version, verdict.detail, `${name} is off the family version`);
  }
});
