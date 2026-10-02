// Tests for the lockstep boot check in src/lib/preflight.js: every installed
// @omega.js package in a brand must sit on the manager's family version.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { assertFamilyVersions } = require('../src/lib/preflight.js');

/** Capture every console.log line emitted while fn runs. */
function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

// ─── The lockstep boot check (#794) ─────────────────────────────────────────

const MANAGER_VERSION = require('../package.json').version;

/**
 * Stage a brand with installed @omega.js packages: `installs` maps a target
 * dir to { framework, version, client?, clientAt? }. clientAt 'nested' puts
 * the client under the framework's own node_modules (where npm nests a
 * second copy), 'root' hoists it to the brand root (where npm normally
 * lands it in a workspace tree).
 */
function stageInstalledBrand(installs, { spec = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lockstep-'));
  const targets = [];

  const writePkg = (dir, contents) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(contents, null, 2));
  };

  for (const [dir, install] of Object.entries(installs)) {
    const targetPath = path.join(root, 'targets', dir);
    const framework = `@omega.js/${install.framework}`;
    writePkg(targetPath, {
      name: `lockstep-${dir}`,
      private: true,
      devDependencies: { [framework]: spec || install.spec || MANAGER_VERSION },
    });
    targets.push({ name: dir, dir: `targets/${dir}`, path: targetPath, target: install.target });

    if (install.version) {
      writePkg(path.join(targetPath, 'node_modules', framework), { name: framework, version: install.version });
    }
    if (install.client) {
      const clientHome = install.clientAt === 'nested'
        ? path.join(targetPath, 'node_modules', framework, 'node_modules', '@omega.js', 'client')
        : path.join(root, 'node_modules', '@omega.js', 'client');
      writePkg(clientHome, { name: '@omega.js/client', version: install.client });
    }
  }

  return { root, targets };
}

test('lockstep boot check: every installed package on the family version passes', () => {
  const { root, targets } = stageInstalledBrand({
    web: { target: 'web', framework: 'web', version: MANAGER_VERSION, client: MANAGER_VERSION },
    backend: { target: 'backend', framework: 'backend', version: MANAGER_VERSION, client: MANAGER_VERSION, clientAt: 'nested' },
  });

  const report = assertFamilyVersions({ brandRoot: root, targets });

  assert.deepEqual(report.mismatched, []);
  assert.deepEqual(report.checked.map((entry) => entry.dir).sort(), ['backend', 'web']);
  // The client is found wherever npm put it: hoisted at the root, or nested
  assert.deepEqual(report.checked.map((entry) => `${entry.dir}:${entry.packages.length}`).sort(), ['backend:2', 'web:2']);
});

test('lockstep boot check: one target behind REFUSES, naming the target, both versions and the fix', () => {
  const { root, targets } = stageInstalledBrand({
    web: { target: 'web', framework: 'web', version: MANAGER_VERSION },
    backend: { target: 'backend', framework: 'backend', version: '0.0.9', client: '0.0.9', clientAt: 'nested' },
  });

  assert.throws(
    () => assertFamilyVersions({ brandRoot: root, targets }),
    (error) => {
      assert.match(error.message, /backend/, 'names the drifted target');
      assert.match(error.message, /@omega\.js\/backend 0\.0\.9/, 'names the installed version');
      assert.match(error.message, /@omega\.js\/client 0\.0\.9/, 'names every drifted package under that target');
      assert.match(error.message, new RegExp(MANAGER_VERSION.replace(/\./g, '\\.')), 'names the manager\'s version');
      assert.equal(error.refusal, true, 'a refusal prints its message alone, no stack (#706)');
      assert.match(error.message, /fix: run `omega update` at the brand root/, 'names the verb that installs, bare');
      assert.ok(!error.message.includes('--apply'), 'no retired switch in the fix');
      assert.ok(!error.message.includes('web'), 'a target that matches is not listed');
      return true;
    },
  );
});

test('lockstep boot check: a `file:` spec is exempt: the local era is the monorepo\'s version by construction', () => {
  const { root, targets } = stageInstalledBrand({
    web: { target: 'web', framework: 'web', version: '9.9.9', client: '9.9.9', clientAt: 'nested' },
  }, { spec: 'file:../../../omega/packages/web' });

  const report = assertFamilyVersions({ brandRoot: root, targets });

  assert.deepEqual(report.mismatched, []);
  assert.deepEqual(report.exempt.map((entry) => entry.dir), ['web']);
});

test('lockstep boot check: a target with no install yet is skipped, not a mismatch', () => {
  const { root, targets } = stageInstalledBrand({
    web: { target: 'web', framework: 'web' },
  });

  const log = captureLog(() => {
    const report = assertFamilyVersions({ brandRoot: root, targets });
    assert.deepEqual(report.mismatched, []);
    assert.deepEqual(report.skipped.map((entry) => entry.dir), ['web']);
  });

  assert.match(log, /web/, 'the skip is a line, never silence');
  assert.match(log, /@omega\.js\/web/);
});

test('lockstep boot check: a custom target has no framework to compare', () => {
  const { root } = stageInstalledBrand({});
  const targets = [{ name: 'worker', dir: 'targets/worker', path: path.join(root, 'targets', 'worker'), target: null, custom: true }];

  const report = assertFamilyVersions({ brandRoot: root, targets });

  assert.deepEqual(report.checked, []);
  assert.deepEqual(report.skipped, []);
});

test('lockstep boot check: an installed manifest that cannot be read is a REFUSAL naming the file (#794)', () => {
  for (const [label, contents] of [['unparseable', '{ not json'], ['versionless', JSON.stringify({ name: '@omega.js/web' })]]) {
    const { root, targets } = stageInstalledBrand({
      web: { target: 'web', framework: 'web', version: MANAGER_VERSION },
    });
    const manifest = path.join(root, 'targets', 'web', 'node_modules', '@omega.js', 'web', 'package.json');
    fs.writeFileSync(manifest, contents);

    assert.throws(
      () => assertFamilyVersions({ brandRoot: root, targets }),
      (error) => {
        assert.equal(error.refusal, true);
        assert.match(error.message, /cannot be read/);
        assert.ok(error.message.includes(manifest), `${label}: the refusal names the file`);
        assert.match(error.message, /npm install/, 'the fix is a reinstall');
        return true;
      },
      `a ${label} manifest must never pass as "no version, no problem"`,
    );
  }
});

test('lockstep boot check: the framework hoisted at the BRAND ROOT is found by the climb', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lockstep-hoist-'));
  const targetPath = path.join(root, 'targets', 'web');
  fs.mkdirSync(targetPath, { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'package.json'), JSON.stringify({
    name: 'hoisted-web', devDependencies: { '@omega.js/web': MANAGER_VERSION },
  }));
  // npm's normal placement in a workspace tree: nothing under the target
  const hoisted = path.join(root, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(hoisted, { recursive: true });
  fs.writeFileSync(path.join(hoisted, 'package.json'), JSON.stringify({ name: '@omega.js/web', version: '0.0.7' }));

  const targets = [{ name: 'web', dir: 'targets/web', path: targetPath, target: 'web' }];

  assert.throws(
    () => assertFamilyVersions({ brandRoot: root, targets }),
    (error) => {
      assert.match(error.message, /@omega\.js\/web 0\.0\.7/, 'the hoisted copy IS the installed copy');
      return true;
    },
  );
});

test('lockstep boot check: a target-local copy WINS over the hoisted one: nearest, climbing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lockstep-nearest-'));
  const targetPath = path.join(root, 'targets', 'web');
  fs.mkdirSync(targetPath, { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'package.json'), JSON.stringify({
    name: 'nearest-web', devDependencies: { '@omega.js/web': MANAGER_VERSION },
  }));

  const hoisted = path.join(root, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(hoisted, { recursive: true });
  fs.writeFileSync(path.join(hoisted, 'package.json'), JSON.stringify({ name: '@omega.js/web', version: '0.0.7' }));

  // The nested copy npm writes when the ranges stop overlapping: what this
  // target actually loads, so it is what the gate must judge
  const local = path.join(targetPath, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({ name: '@omega.js/web', version: MANAGER_VERSION }));

  const targets = [{ name: 'web', dir: 'targets/web', path: targetPath, target: 'web' }];
  const report = assertFamilyVersions({ brandRoot: root, targets });

  assert.deepEqual(report.mismatched, [], 'the target-local copy matches, so the stale hoisted one is not what runs here');
  assert.deepEqual(report.checked[0].packages, [{ name: '@omega.js/web', version: MANAGER_VERSION }]);
});
