// Unit tests for src/local.js — local-development linking (master plan §8).
//
// Real-execution only (no mocks): monorepo resolution runs against THIS repo
// (the tests live inside it, so self-location must find it), brand/target
// detection runs against committed fixtures, and linking is exercised in
// dryRun mode plus a real-symlink skip case in a temp dir. ONE real
// `npm install` runs (cp194): the tree-wide link regression lives in npm's
// workspace resolution itself, so only a real install can pin it — it's
// offline by construction (file: specs only) and cheap.

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

// ---- findBrandRoot / discoverTargets

test('findBrandRoot walks up from a target to the brand monorepo root', () => {
  const brand = path.join(FIXTURES, 'brand');
  assert.equal(local.findBrandRoot(path.join(brand, 'targets', 'site')), brand);
  assert.equal(local.findBrandRoot(path.join(brand, 'targets', 'backend-api', 'functions')), brand);
  assert.equal(local.findBrandRoot(brand), brand);
});

test('findBrandRoot treats a standalone project as its own root — never the Omega monorepo', () => {
  const standalone = path.join(FIXTURES, 'standalone-project');
  // The fixture lives INSIDE the Omega monorepo (which has brands/) — the walk
  // must stop at the project, not classify the monorepo as a brand.
  assert.equal(local.findBrandRoot(standalone), standalone);
});

test('discoverTargets lists the brand root plus every target with a package.json', () => {
  const brand = path.join(FIXTURES, 'brand');
  assert.deepEqual(local.discoverTargets(brand), [
    brand,
    path.join(brand, 'targets', 'backend-api'),
    path.join(brand, 'targets', 'site'),
  ]);
});

test('discoverTargets on a standalone project returns just that project', () => {
  const standalone = path.join(FIXTURES, 'standalone-project');
  assert.deepEqual(local.discoverTargets(standalone), [standalone]);
});

// ---- frameworkPackagesOf

test('frameworkPackagesOf finds deps and devDeps with placement flags', () => {
  const site = path.join(FIXTURES, 'brand', 'targets', 'site');
  assert.deepEqual(local.frameworkPackagesOf(site), [
    { name: '@omega.js/client', spec: '^5.0.0', dev: false, dir: site },
    { name: '@omega.js/web', spec: '^0.2.0', dev: true, dir: site },
  ]);
});

test('frameworkPackagesOf reads the target-root manifest (src/dist pillar — no functions/ probe)', () => {
  const backendTarget = path.join(FIXTURES, 'brand', 'targets', 'backend-api');
  assert.deepEqual(local.frameworkPackagesOf(backendTarget), [
    { name: '@omega.js/backend', spec: '^6.0.0', dev: false, dir: backendTarget },
  ]);
});

test('frameworkPackagesOf is empty for a package with no @omega.js deps', () => {
  assert.deepEqual(local.frameworkPackagesOf(path.join(FIXTURES, 'brand')), []);
});

// ---- linkLocalPackages (dryRun + real-symlink skip detection)

test('linkLocalPackages plans the WHOLE brand tree: sibling targets included (cp194)', async () => {
  const site = path.join(FIXTURES, 'brand', 'targets', 'site');
  const actions = await local.linkLocalPackages({ dir: site, monorepoRoot: FAKE_MONOREPO, dryRun: true });
  assert.deepEqual(
    actions.map(({ name, action }) => ({ name, action })),
    [
      { name: '@omega.js/backend', action: 'missing' }, // sibling target scanned too — npm resolves the whole workspace tree
      { name: '@omega.js/client', action: 'link' },     // fake monorepo has packages/client
      { name: '@omega.js/web', action: 'missing' },     // ...but no packages/web
    ]
  );
});

test('linkLocalPackages skips deps already resolving to the monorepo copy', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-local-test-'));
  try {
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({
      name: 'scratch-target',
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

test('linkLocalPackages links a fresh outside brand with ONE real install — unpublished sibling specs cannot 404 (cp194)', async () => {
  // Two targets whose @omega.js deps exist ONLY in the fake monorepo: with the
  // old per-dep `npm install <path>` mechanics, linking target-a died on target-b's
  // registry-unresolvable spec. The tree-wide flip must link both offline.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-local-brand-'));
  try {
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({
      name: 'scratch-brand', private: true, workspaces: ['targets/*'],
    }));
    const targetA = path.join(scratch, 'targets', 'target-a');
    const targetB = path.join(scratch, 'targets', 'target-b');
    fs.mkdirSync(targetA, { recursive: true });
    fs.mkdirSync(targetB, { recursive: true });
    fs.writeFileSync(path.join(targetA, 'package.json'), JSON.stringify({
      name: 'scratch-target-a', private: true, dependencies: { '@omega.js/client': '*' },
    }));
    fs.writeFileSync(path.join(targetB, 'package.json'), JSON.stringify({
      name: 'scratch-target-b', private: true, devDependencies: { '@omega.js/devkit': '*' },
    }));

    const actions = await local.linkLocalPackages({ dir: targetA, monorepoRoot: FAKE_MONOREPO });
    assert.deepEqual(actions.map(({ name, action }) => ({ name, action })), [
      { name: '@omega.js/client', action: 'link' },
      { name: '@omega.js/devkit', action: 'link' },
    ]);

    // Specs flipped in place, placement preserved
    const pkgA = JSON.parse(fs.readFileSync(path.join(targetA, 'package.json'), 'utf8'));
    const pkgB = JSON.parse(fs.readFileSync(path.join(targetB, 'package.json'), 'utf8'));
    assert.match(pkgA.dependencies['@omega.js/client'], /^file:/, 'app-a dep flipped to file:');
    assert.match(pkgB.devDependencies['@omega.js/devkit'], /^file:/, 'app-b devDep flipped to file: in place');

    // The one real install materialized links for BOTH targets (hoisted)
    assert.equal(
      fs.realpathSync(path.join(scratch, 'node_modules', '@omega.js', 'client')),
      fs.realpathSync(path.join(FAKE_MONOREPO, 'packages', 'client')),
      'client resolves to the monorepo copy'
    );
    assert.equal(
      fs.realpathSync(path.join(scratch, 'node_modules', '@omega.js', 'devkit')),
      fs.realpathSync(path.join(FAKE_MONOREPO, 'packages', 'devkit')),
      'sibling devkit resolves to the monorepo copy'
    );

    // Rerun converges: everything skips, no manifest churn
    const before = fs.readFileSync(path.join(targetA, 'package.json'), 'utf8');
    const again = await local.linkLocalPackages({ dir: targetA, monorepoRoot: FAKE_MONOREPO });
    assert.deepEqual(again.map(({ action }) => action), ['skip', 'skip'], 'second run all-skip');
    assert.equal(fs.readFileSync(path.join(targetA, 'package.json'), 'utf8'), before, 'no rewrite on rerun');
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

/**
 * Stage a brand root whose one target declares @omega.js/web, beside a
 * monorepo-shaped checkout. `link` decides how the dependency resolves:
 * 'registry' installs a real directory under node_modules, 'monorepo' symlinks
 * it to the checkout's packages/web.
 * @param {string} link - 'registry' | 'monorepo'
 * @returns {{ scratch: string, brandRoot: string, monorepoRoot: string }}
 */
function stageLinkedBrand(link) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-linked-brand-')));
  const monorepoRoot = path.join(scratch, 'omega');
  const brandRoot = path.join(scratch, 'brand');
  const target = path.join(brandRoot, 'targets', 'website');
  const installed = path.join(brandRoot, 'node_modules', '@omega.js', 'web');

  fs.mkdirSync(path.join(monorepoRoot, 'packages', 'devkit'), { recursive: true });
  fs.mkdirSync(path.join(monorepoRoot, 'packages', 'web'), { recursive: true });
  fs.writeFileSync(path.join(monorepoRoot, 'package.json'), JSON.stringify({ name: 'omega', private: true }));
  fs.writeFileSync(path.join(monorepoRoot, 'packages', 'devkit', 'package.json'), JSON.stringify({ name: '@omega.js/devkit' }));
  fs.writeFileSync(path.join(monorepoRoot, 'packages', 'web', 'package.json'), JSON.stringify({ name: '@omega.js/web' }));

  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'package.json'), JSON.stringify({ name: 'fixture-brand', private: true }));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'fixture-site', dependencies: { '@omega.js/web': '*' } }));

  fs.mkdirSync(path.dirname(installed), { recursive: true });
  if (link === 'monorepo') {
    fs.symlinkSync(path.join(monorepoRoot, 'packages', 'web'), installed, 'dir');
  } else {
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: '@omega.js/web', version: '1.0.0' }));
  }

  return { scratch, brandRoot, monorepoRoot };
}

test('#587: resolveLinkedMonorepo names the checkout a brand resolves INTO', () => {
  const { scratch, brandRoot, monorepoRoot } = stageLinkedBrand('monorepo');
  try {
    assert.equal(local.resolveLinkedMonorepo(brandRoot), monorepoRoot);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('#587: a registry-installed brand resolves into no monorepo at all', () => {
  const { scratch, brandRoot } = stageLinkedBrand('registry');
  try {
    assert.equal(local.resolveLinkedMonorepo(brandRoot), null);
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
function vendorScratch({ withSrc = true } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-vendor-prop-'));
  const packagesDir = path.join(scratch, 'packages');
  // withSrc: false → no real fs watcher installs, so poke()-driven tests
  // exercise the pass machinery alone (macOS FSEvents can replay the recent
  // mkdir as a spurious event under load — a real watcher on the scratch dir
  // makes poke-based assertions racy)
  fs.mkdirSync(withSrc ? path.join(packagesDir, 'devkit', 'src') : packagesDir, { recursive: true });
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
  const { scratch, packagesDir } = vendorScratch({ withSrc: false });
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
  const { scratch, packagesDir } = vendorScratch({ withSrc: false });
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
  const { scratch, packagesDir } = vendorScratch({ withSrc: false });
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
  const { scratch, packagesDir } = vendorScratch({ withSrc: false });
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
  const { scratch, packagesDir } = vendorScratch({ withSrc: false });
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

// ---- restoreRegistrySpecs (the publish-day inverse)

test('restoreRegistrySpecs plans ^<linked version> for file: specs and skips registry specs', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-restore-'));
  try {
    // A fake linked package whose version the flip derives
    const pkgDir = path.join(scratch, 'monorepo', 'packages', 'client');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@omega.js/client', version: '0.1.0' }));

    const brand = path.join(scratch, 'brand');
    const targetDir = path.join(brand, 'targets', 'site');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({ name: 'brand', private: true, workspaces: ['targets/*'] }));
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({
      name: 'site',
      dependencies: {
        '@omega.js/client': `file:${path.relative(targetDir, pkgDir).split(path.sep).join('/')}`,
        '@omega.js/web': '^0.1.0',
      },
    }));

    const actions = await local.restoreRegistrySpecs({ dir: targetDir, dryRun: true });
    assert.deepEqual(actions.map(({ name, spec, action }) => ({ name, spec, action })), [
      { name: '@omega.js/client', spec: '^0.1.0', action: 'flip' },
      { name: '@omega.js/web', spec: '^0.1.0', action: 'skip' },
    ]);

    // Explicit range override wins over the derived version
    const overridden = await local.restoreRegistrySpecs({ dir: targetDir, dryRun: true, range: '^0.2.0' });
    assert.equal(overridden.find((action) => action.name === '@omega.js/client').spec, '^0.2.0');

    // dryRun writes nothing — the file: spec survives verbatim
    const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8'));
    assert.ok(manifest.dependencies['@omega.js/client'].startsWith('file:'));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
