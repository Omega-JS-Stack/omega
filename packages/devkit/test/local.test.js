// Unit tests for src/local.js — local-development linking (master plan §8).
//
// Real-execution only (no mocks): monorepo resolution runs against THIS repo
// (the tests live inside it, so self-location must find it), brand/app
// detection runs against committed fixtures, and linking is exercised in
// dryRun mode plus a real-symlink skip case in a temp dir. Actual `npm install`
// runs are left to the live sandbox proof — too heavy for a unit test.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const local = require('../src/local');

const MONOREPO_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..', '..'));
const FIXTURES = path.join(__dirname, 'fixtures', 'local');
const FAKE_MONOREPO = path.join(FIXTURES, 'fake-monorepo');

/** Run fn with OMEGA_MONOREPO set (or deleted for undefined), restoring after. */
function withEnv(value, fn) {
  const previous = process.env.OMEGA_MONOREPO;
  if (value === undefined) {
    delete process.env.OMEGA_MONOREPO;
  } else {
    process.env.OMEGA_MONOREPO = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.OMEGA_MONOREPO;
    } else {
      process.env.OMEGA_MONOREPO = previous;
    }
  }
}

// ---- isMonorepoRoot / resolveMonorepoRoot

test('isMonorepoRoot accepts the real monorepo and the fixture fake', () => {
  assert.equal(local.isMonorepoRoot(MONOREPO_ROOT), true);
  assert.equal(local.isMonorepoRoot(FAKE_MONOREPO), true);
});

test('isMonorepoRoot rejects a plain package and a missing dir', () => {
  assert.equal(local.isMonorepoRoot(path.join(FIXTURES, 'brand')), false);
  assert.equal(local.isMonorepoRoot(path.join(FIXTURES, 'nope')), false);
});

test('resolveMonorepoRoot self-locates the repo these tests run inside', () => {
  withEnv(undefined, () => {
    assert.equal(local.resolveMonorepoRoot(), MONOREPO_ROOT);
  });
});

test('resolveMonorepoRoot honors OMEGA_MONOREPO override', () => {
  withEnv(FAKE_MONOREPO, () => {
    assert.equal(local.resolveMonorepoRoot(), path.resolve(FAKE_MONOREPO));
  });
});

test('resolveMonorepoRoot throws on an invalid OMEGA_MONOREPO', () => {
  withEnv(path.join(FIXTURES, 'brand'), () => {
    assert.throws(() => local.resolveMonorepoRoot(), /OMEGA_MONOREPO/);
  });
});

// ---- packageDir

test('packageDir maps a scoped name to its packages/ directory', () => {
  assert.equal(local.packageDir('/repo', '@omegajs/client'), path.join('/repo', 'packages', 'client'));
});

// ---- findBrandRoot / discoverApps

test('findBrandRoot walks up from an app to the brand monorepo root', () => {
  const brand = path.join(FIXTURES, 'brand');
  assert.equal(local.findBrandRoot(path.join(brand, 'apps', 'site')), brand);
  assert.equal(local.findBrandRoot(path.join(brand, 'apps', 'backend-app', 'functions')), brand);
  assert.equal(local.findBrandRoot(brand), brand);
});

test('findBrandRoot treats a standalone app as its own root — never the Omega monorepo', () => {
  const standalone = path.join(FIXTURES, 'standalone-app');
  // The fixture lives INSIDE the Omega monorepo (which has apps/) — the walk
  // must stop at the app, not classify the monorepo as a brand.
  assert.equal(local.findBrandRoot(standalone), standalone);
});

test('discoverApps lists the brand root plus every app with a package.json', () => {
  const brand = path.join(FIXTURES, 'brand');
  assert.deepEqual(local.discoverApps(brand), [
    brand,
    path.join(brand, 'apps', 'backend-app'),
    path.join(brand, 'apps', 'site'),
  ]);
});

test('discoverApps on a standalone app returns just the app', () => {
  const standalone = path.join(FIXTURES, 'standalone-app');
  assert.deepEqual(local.discoverApps(standalone), [standalone]);
});

// ---- frameworkPackagesOf

test('frameworkPackagesOf finds deps and devDeps with placement flags', () => {
  const site = path.join(FIXTURES, 'brand', 'apps', 'site');
  assert.deepEqual(local.frameworkPackagesOf(site), [
    { name: '@omegajs/client', spec: '^5.0.0', dev: false, dir: site },
    { name: '@omegajs/web', spec: '^0.2.0', dev: true, dir: site },
  ]);
});

test('frameworkPackagesOf reaches into functions/ for backend apps', () => {
  const backendApp = path.join(FIXTURES, 'brand', 'apps', 'backend-app');
  assert.deepEqual(local.frameworkPackagesOf(backendApp), [
    { name: '@omegajs/backend', spec: '^6.0.0', dev: false, dir: path.join(backendApp, 'functions') },
  ]);
});

test('frameworkPackagesOf is empty for a package with no @omegajs deps', () => {
  assert.deepEqual(local.frameworkPackagesOf(path.join(FIXTURES, 'brand')), []);
});

// ---- linkLocalPackages (dryRun + real-symlink skip detection)

test('linkLocalPackages plans link for unlinked deps and missing for absent packages', async () => {
  const site = path.join(FIXTURES, 'brand', 'apps', 'site');
  const actions = await local.linkLocalPackages({ dir: site, monorepoRoot: FAKE_MONOREPO, dryRun: true });
  assert.deepEqual(
    actions.map(({ name, action }) => ({ name, action })),
    [
      { name: '@omegajs/client', action: 'link' }, // fake monorepo has packages/client
      { name: '@omegajs/web', action: 'missing' }, // ...but no packages/web
    ]
  );
});

test('linkLocalPackages skips deps already resolving to the monorepo copy', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-local-test-'));
  try {
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({
      name: 'scratch-app',
      dependencies: { '@omegajs/client': '^5.0.0' },
    }));
    fs.mkdirSync(path.join(scratch, 'node_modules', '@omegajs'), { recursive: true });
    fs.symlinkSync(path.join(FAKE_MONOREPO, 'packages', 'client'), path.join(scratch, 'node_modules', '@omegajs', 'client'));

    const actions = await local.linkLocalPackages({ dir: scratch, monorepoRoot: FAKE_MONOREPO, dryRun: true });
    assert.deepEqual(actions.map(({ name, action }) => ({ name, action })), [
      { name: '@omegajs/client', action: 'skip' },
    ]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- Watch lock

test('acquireWatchLock takes, holds, and releases the single-instance lock', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lock-test-'));
  try {
    const first = local.acquireWatchLock(scratch);
    assert.deepEqual(first, { acquired: true, pid: process.pid });
    assert.equal(fs.existsSync(path.join(scratch, local.WATCH_LOCK)), true);

    // Second take fails while the (live) owner holds it
    const second = local.acquireWatchLock(scratch);
    assert.deepEqual(second, { acquired: false, pid: process.pid });

    local.releaseWatchLock(scratch);
    assert.equal(fs.existsSync(path.join(scratch, local.WATCH_LOCK)), false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a stale lock (dead pid) is cleared and re-acquirable', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lock-test-'));
  try {
    // A real pid that is guaranteed dead: a child that has already exited
    const dead = spawnSync(process.execPath, ['-e', '']);
    const lockPath = path.join(scratch, local.WATCH_LOCK);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: dead.pid }));

    assert.equal(local.readLiveWatchPid(scratch), null);
    assert.equal(fs.existsSync(lockPath), false); // stale lock swept
    assert.equal(local.acquireWatchLock(scratch).acquired, true);
    local.releaseWatchLock(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('startMonorepoWatch declines to double-start when the lock is held', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lock-test-'));
  try {
    local.acquireWatchLock(scratch); // held by us — a live process
    const result = local.startMonorepoWatch({ monorepoRoot: scratch });
    assert.deepEqual(result, { alreadyRunning: true, pid: process.pid, child: null });
    local.releaseWatchLock(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
