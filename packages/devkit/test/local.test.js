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
  assert.equal(local.packageDir('/repo', '@omega.js/client'), path.join('/repo', 'packages', 'client'));
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
    { name: '@omega.js/client', spec: '^5.0.0', dev: false, dir: site },
    { name: '@omega.js/web', spec: '^0.2.0', dev: true, dir: site },
  ]);
});

test('frameworkPackagesOf reads the app-root manifest (src/dist pillar — no functions/ probe)', () => {
  const backendApp = path.join(FIXTURES, 'brand', 'apps', 'backend-app');
  assert.deepEqual(local.frameworkPackagesOf(backendApp), [
    { name: '@omega.js/backend', spec: '^6.0.0', dev: false, dir: backendApp },
  ]);
});

test('frameworkPackagesOf is empty for a package with no @omega.js deps', () => {
  assert.deepEqual(local.frameworkPackagesOf(path.join(FIXTURES, 'brand')), []);
});

// ---- linkLocalPackages (dryRun + real-symlink skip detection)

test('linkLocalPackages plans link for unlinked deps and missing for absent packages', async () => {
  const site = path.join(FIXTURES, 'brand', 'apps', 'site');
  const actions = await local.linkLocalPackages({ dir: site, monorepoRoot: FAKE_MONOREPO, dryRun: true });
  assert.deepEqual(
    actions.map(({ name, action }) => ({ name, action })),
    [
      { name: '@omega.js/client', action: 'link' }, // fake monorepo has packages/client
      { name: '@omega.js/web', action: 'missing' }, // ...but no packages/web
    ]
  );
});

test('linkLocalPackages skips deps already resolving to the monorepo copy', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-local-test-'));
  try {
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({
      name: 'scratch-app',
      dependencies: { '@omega.js/client': '^5.0.0' },
    }));
    fs.mkdirSync(path.join(scratch, 'node_modules', '@omega.js'), { recursive: true });
    fs.symlinkSync(path.join(FAKE_MONOREPO, 'packages', 'client'), path.join(scratch, 'node_modules', '@omega.js', 'client'));

    const actions = await local.linkLocalPackages({ dir: scratch, monorepoRoot: FAKE_MONOREPO, dryRun: true });
    assert.deepEqual(actions.map(({ name, action }) => ({ name, action })), [
      { name: '@omega.js/client', action: 'skip' },
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

// ---- Vendor propagation

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until check() is true or fail with what after timeoutMs. */
async function waitUntil(check, what, timeoutMs = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await sleep(25);
  }
}

/** Scratch packages/ tree with a devkit-like src dir. Caller removes scratch. */
function vendorScratch() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-vendor-prop-'));
  const packagesDir = path.join(scratch, 'packages');
  fs.mkdirSync(path.join(packagesDir, 'devkit', 'src'), { recursive: true });
  return { scratch, packagesDir };
}

// The pass/debounce/coalesce logic is tested through poke() — the documented
// seam the real fs watchers feed (macOS FSEvents streams activate
// asynchronously, so a write landing right after fs.watch() can be lost;
// the one integration test below covers the fs layer flake-free).

test('startVendorPropagation watches only packages with an existing src/', () => {
  const { scratch, packagesDir } = vendorScratch();
  const propagation = local.startVendorPropagation({
    packagesDir,
    packages: ['devkit', 'config', 'account'], // only devkit/src exists in the scratch
    dependents: [],
  });
  try {
    assert.deepEqual(propagation.watched, ['devkit']);
  } finally {
    propagation.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a change re-prepares every dependent, in order', async () => {
  const { scratch, packagesDir } = vendorScratch();
  const calls = [];
  const propagation = local.startVendorPropagation({
    packagesDir,
    packages: ['devkit'],
    dependents: [{ name: 'backend', dir: '/x' }, { name: 'client', dir: '/y' }],
    runPrepare: async (dependent) => { calls.push(dependent.name); },
    debounceMs: 25,
  });
  try {
    propagation.poke('devkit');
    await waitUntil(() => calls.length >= 2, 'the pass to cover both dependents');
    await sleep(150); // settle: a single change must not schedule another pass
    assert.deepEqual(calls, ['backend', 'client']);
  } finally {
    propagation.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('rapid changes inside the debounce window coalesce into one pass', async () => {
  const { scratch, packagesDir } = vendorScratch();
  const calls = [];
  const propagation = local.startVendorPropagation({
    packagesDir,
    packages: ['devkit'],
    dependents: [{ name: 'backend', dir: '/x' }],
    runPrepare: async (dependent) => { calls.push(dependent.name); },
    debounceMs: 50,
  });
  try {
    propagation.poke('devkit');
    propagation.poke('devkit');
    propagation.poke('devkit');
    await waitUntil(() => calls.length >= 1, 'the coalesced pass');
    await sleep(200); // settle: the burst must not schedule further passes
    assert.deepEqual(calls, ['backend']);
  } finally {
    propagation.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a change landing mid-pass queues exactly one follow-up pass', async () => {
  const { scratch, packagesDir } = vendorScratch();
  const calls = [];
  const resolvers = [];
  const propagation = local.startVendorPropagation({
    packagesDir,
    packages: ['devkit'],
    dependents: [{ name: 'backend', dir: '/x' }],
    runPrepare: (dependent) => new Promise((resolve) => {
      calls.push(dependent.name);
      resolvers.push(resolve);
    }),
    debounceMs: 25,
  });
  try {
    propagation.poke('devkit');
    await waitUntil(() => calls.length === 1, 'the first pass to start');

    // Two more changes while the first pass is still blocked in runPrepare —
    // they must fold into ONE follow-up, not one pass per change
    propagation.poke('devkit');
    propagation.poke('devkit');
    await sleep(100); // let their debounce fire and mark the run pending
    resolvers.shift()();

    await waitUntil(() => calls.length === 2, 'the follow-up pass');
    resolvers.shift()();
    await sleep(200); // settle: no third pass
    assert.equal(calls.length, 2);
  } finally {
    propagation.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a failing prepare is contained — the rest of the pass still runs', async () => {
  const { scratch, packagesDir } = vendorScratch();
  const calls = [];
  const logs = [];
  const propagation = local.startVendorPropagation({
    packagesDir,
    packages: ['devkit'],
    dependents: [{ name: 'backend', dir: '/x' }, { name: 'client', dir: '/y' }],
    runPrepare: async (dependent) => {
      calls.push(dependent.name);
      if (dependent.name === 'backend') {
        throw new Error('boom');
      }
    },
    log: (line) => logs.push(line),
    debounceMs: 25,
  });
  try {
    propagation.poke('devkit');
    await waitUntil(() => calls.length >= 2, 'the pass to reach the second dependent');
    assert.deepEqual(calls, ['backend', 'client']);
    assert.ok(logs.some((line) => line.includes('backend') && line.includes('boom')), 'failure surfaced in the log');
  } finally {
    propagation.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('close() stops the watch — later changes trigger nothing', async () => {
  const { scratch, packagesDir } = vendorScratch();
  const calls = [];
  const propagation = local.startVendorPropagation({
    packagesDir,
    packages: ['devkit'],
    dependents: [{ name: 'backend', dir: '/x' }],
    runPrepare: async (dependent) => { calls.push(dependent.name); },
    debounceMs: 25,
  });
  propagation.close();
  try {
    propagation.poke('devkit');
    await sleep(150);
    assert.deepEqual(calls, []);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the real fs watch feeds the same pipeline (recursive, by package name)', async () => {
  const { scratch, packagesDir } = vendorScratch();
  const calls = [];
  const propagation = local.startVendorPropagation({
    packagesDir,
    packages: ['devkit'],
    dependents: [{ name: 'backend', dir: '/x' }, { name: 'client', dir: '/y' }],
    runPrepare: async (dependent) => { calls.push(dependent.name); },
    debounceMs: 25,
  });
  try {
    // A nested dir proves recursive: true carries. FSEvents activates
    // asynchronously, so keep editing until the pipeline reacts instead of
    // trusting the first write to be seen.
    const deepDir = path.join(packagesDir, 'devkit', 'src', 'nested');
    fs.mkdirSync(deepDir, { recursive: true });
    const target = path.join(deepDir, 'deep.js');
    const start = Date.now();
    let version = 0;
    while (calls.length === 0) {
      if (Date.now() - start > 10000) {
        throw new Error('fs.watch never delivered an event');
      }
      fs.writeFileSync(target, `// v${version += 1}\n`);
      await sleep(200);
    }

    // Late events may run extra passes — assert structure, not pass count:
    // every completed pass covers both dependents in order.
    await waitUntil(() => calls.length >= 2, 'the first pass to complete');
    await sleep(300);
    assert.ok(calls.length >= 2, 'at least one full pass ran');
    for (let i = 0; i + 1 < calls.length; i += 2) {
      assert.deepEqual(calls.slice(i, i + 2), ['backend', 'client'], `pass ${i / 2} covers both dependents in order`);
    }
  } finally {
    propagation.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
