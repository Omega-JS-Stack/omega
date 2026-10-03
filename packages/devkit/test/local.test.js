// Unit tests for src/local.js — local-development linking (master plan §8).
//
// Real-execution only (no mocks): monorepo resolution runs against THIS repo
// (the tests live inside it, so self-location must find it), brand/target
// detection runs against committed fixtures, and linking is exercised in
// dryRun mode plus a real-symlink skip case in a temp dir. Real `npm install`
// runs where npm's own resolution IS the behavior (cp194's tree-wide link, and
// #938's brand lockfile inside an outer workspace): offline by construction,
// file: specs, and a registry stub on an ephemeral 127.0.0.1 port for the
// registry side.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const crypto = require('node:crypto');
const local = require('../src/local');
const { assertBrandLockfile } = require('../src/brand-version');
const { regenerateLockfile } = require('../src/lockfile');

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
  const target = path.join(brandRoot, 'targets', 'web');
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

// ---- #938: both flips regenerate the brand's OWN lockfile

/**
 * A brand nested inside an OUTER workspace root (the in-monorepo shape: the
 * omega monorepo lists `brands/*` as its workspaces), with one target.
 * A plain `npm install` in the brand climbs to the outer root and writes THAT
 * lockfile, which is the bug the flips have to answer for.
 *
 * @param {object} dependencies - target-a's dependencies.
 * @returns {{ scratch: string, outer: string, brand: string, targetA: string }}
 */
function makeNestedBrand(dependencies) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-nested-brand-')));
  const outer = path.join(scratch, 'outer');
  const brand = path.join(outer, 'brand');
  const targetA = path.join(brand, 'targets', 'target-a');
  fs.mkdirSync(targetA, { recursive: true });
  fs.writeFileSync(path.join(outer, 'package.json'), JSON.stringify({ name: 'outer', private: true, workspaces: ['brand'] }));
  fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({ name: 'nested-brand', private: true, workspaces: ['targets/*'] }));
  fs.writeFileSync(path.join(targetA, 'package.json'), JSON.stringify({ name: 'nested-target-a', private: true, dependencies }));
  return { scratch, outer, brand, targetA };
}

/**
 * A one-package npm registry on an ephemeral 127.0.0.1 port, serving
 * `@omega.js/client@0.1.0` packed from a real directory, and pointing npm at it
 * for the duration of `fn` (an isolated cache, so nothing leaks either way).
 *
 * @param {Function} expect - the calling case's `ctx.expect`.
 * @param {string} scratch - Where the package and the cache live.
 * @param {function} fn - async ({ url, requests }) => void
 */
async function withRegistry(expect, scratch, fn) {
  const source = path.join(scratch, 'registry-src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: '@omega.js/client', version: '0.1.0' }));
  const packed = spawnSync('npm', ['pack', '--pack-destination', scratch], { cwd: source, encoding: 'utf8' });
  expect(packed.status, packed.stderr).toBe(0);
  const tarball = fs.readFileSync(path.join(scratch, 'omega.js-client-0.1.0.tgz'));
  const integrity = `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`;

  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const url = `http://127.0.0.1:${server.address().port}`;
    if (req.url.endsWith('.tgz')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(tarball);
    }
    if (decodeURIComponent(req.url) === '/@omega.js/client') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        name: '@omega.js/client',
        'dist-tags': { latest: '0.1.0' },
        versions: { '0.1.0': { name: '@omega.js/client', version: '0.1.0', dist: { tarball: `${url}/client-0.1.0.tgz`, integrity } } },
      }));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const url = `http://127.0.0.1:${server.address().port}`;
  const env = { npm_config_registry: `${url}/`, npm_config_cache: path.join(scratch, 'npm-cache'), npm_config_update_notifier: 'false' };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    await fn({ url, requests });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

/** The lock the local era left behind: @omega.js/client a LINK into a checkout. */
function writeStaleLinkLock(brand, linkTarget) {
  fs.writeFileSync(path.join(brand, 'package-lock.json'), JSON.stringify({
    name: 'nested-brand',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'nested-brand', workspaces: ['targets/*'] },
      [linkTarget]: { name: '@omega.js/client', version: '0.1.0' },
      'node_modules/@omega.js/client': { resolved: linkTarget, link: true },
      'node_modules/nested-target-a': { resolved: 'targets/target-a', link: true },
      'targets/target-a': { name: 'nested-target-a', dependencies: { '@omega.js/client': `file:../../${linkTarget}` } },
    },
  }, null, 2));
}

/**
 * A nested brand still on its local-era link: target-a's `file:` spec points at
 * a linked copy that sits at the SAME version the flip writes, under a stale
 * link lock. npm alone would accept the old link as satisfying `0.1.0` and keep
 * it (the 0.51.0 failure).
 *
 * @returns {{ scratch: string, outer: string, brand: string, targetA: string, linked: string }}
 */
function makeLinkedBrand() {
  const { scratch, outer, brand, targetA } = makeNestedBrand({});
  const linked = path.join(scratch, 'linked-client');
  fs.mkdirSync(linked, { recursive: true });
  fs.writeFileSync(path.join(linked, 'package.json'), JSON.stringify({ name: '@omega.js/client', version: '0.1.0' }));
  fs.writeFileSync(path.join(targetA, 'package.json'), JSON.stringify({
    name: 'nested-target-a', private: true, dependencies: { '@omega.js/client': 'file:../../../../linked-client' },
  }));
  writeStaleLinkLock(brand, '../../linked-client');
  return { scratch, outer, brand, targetA, linked };
}

module.exports = defineCases({
  type: 'group',
  description: 'local',
  tests: [
    // ---- isMonorepoRoot / resolveMonorepoRoot

    {
      name: 'isMonorepoRoot accepts the real monorepo and the fixture fake',
      run: (ctx) => {
        ctx.expect(local.isMonorepoRoot(MONOREPO_ROOT)).toBe(true);
        ctx.expect(local.isMonorepoRoot(FAKE_MONOREPO)).toBe(true);
      },
    },

    {
      name: 'isMonorepoRoot rejects a plain package and a missing dir',
      run: (ctx) => {
        ctx.expect(local.isMonorepoRoot(path.join(FIXTURES, 'brand'))).toBe(false);
        ctx.expect(local.isMonorepoRoot(path.join(FIXTURES, 'nope'))).toBe(false);
      },
    },

    {
      name: 'resolveMonorepoRoot self-locates the repo these tests run inside',
      run: (ctx) => {
        withEnv(undefined, () => {
          ctx.expect(local.resolveMonorepoRoot()).toBe(MONOREPO_ROOT);
        });
      },
    },

    {
      name: 'resolveMonorepoRoot honors OMEGA_MONOREPO override',
      run: (ctx) => {
        withEnv(FAKE_MONOREPO, () => {
          ctx.expect(local.resolveMonorepoRoot()).toBe(path.resolve(FAKE_MONOREPO));
        });
      },
    },

    {
      name: 'resolveMonorepoRoot throws on an invalid OMEGA_MONOREPO',
      run: (ctx) => {
        withEnv(path.join(FIXTURES, 'brand'), () => {
          ctx.expect(() => local.resolveMonorepoRoot()).toThrow(/OMEGA_MONOREPO/);
        });
      },
    },

    // ---- packageDir

    {
      name: 'packageDir maps a scoped name to its packages/ directory',
      run: (ctx) => {
        ctx.expect(local.packageDir('/repo', '@omega.js/client')).toBe(path.join('/repo', 'packages', 'client'));
      },
    },

    // ---- findBrandRoot / discoverTargets

    {
      name: 'findBrandRoot walks up from a target to the brand monorepo root',
      run: (ctx) => {
        const brand = path.join(FIXTURES, 'brand');
        ctx.expect(local.findBrandRoot(path.join(brand, 'targets', 'site'))).toBe(brand);
        ctx.expect(local.findBrandRoot(path.join(brand, 'targets', 'backend-api', 'functions'))).toBe(brand);
        ctx.expect(local.findBrandRoot(brand)).toBe(brand);
      },
    },

    {
      name: 'findBrandRoot treats a standalone project as its own root — never the Omega monorepo',
      run: (ctx) => {
        const standalone = path.join(FIXTURES, 'standalone-project');
        // The fixture lives INSIDE the Omega monorepo (which has brands/) — the walk
        // must stop at the project, not classify the monorepo as a brand.
        ctx.expect(local.findBrandRoot(standalone)).toBe(standalone);
      },
    },

    {
      name: 'discoverTargets lists the brand root plus every target with a package.json',
      run: (ctx) => {
        const brand = path.join(FIXTURES, 'brand');
        ctx.expect(local.discoverTargets(brand)).toEqual([
          brand,
          path.join(brand, 'targets', 'backend-api'),
          path.join(brand, 'targets', 'site'),
        ]);
      },
    },

    {
      name: 'discoverTargets on a standalone project returns just that project',
      run: (ctx) => {
        const standalone = path.join(FIXTURES, 'standalone-project');
        ctx.expect(local.discoverTargets(standalone)).toEqual([standalone]);
      },
    },

    // ---- frameworkPackagesOf

    {
      name: 'frameworkPackagesOf finds deps and devDeps with placement flags',
      run: (ctx) => {
        const site = path.join(FIXTURES, 'brand', 'targets', 'site');
        ctx.expect(local.frameworkPackagesOf(site)).toEqual([
          { name: '@omega.js/client', spec: '^5.0.0', dev: false, dir: site },
          { name: '@omega.js/web', spec: '^0.2.0', dev: true, dir: site },
        ]);
      },
    },

    {
      name: 'frameworkPackagesOf reads the target-root manifest (src/dist pillar — no functions/ probe)',
      run: (ctx) => {
        const backendTarget = path.join(FIXTURES, 'brand', 'targets', 'backend-api');
        ctx.expect(local.frameworkPackagesOf(backendTarget)).toEqual([
          { name: '@omega.js/backend', spec: '^6.0.0', dev: false, dir: backendTarget },
        ]);
      },
    },

    {
      name: 'frameworkPackagesOf is empty for a package with no @omega.js deps',
      run: (ctx) => {
        ctx.expect(local.frameworkPackagesOf(path.join(FIXTURES, 'brand'))).toEqual([]);
      },
    },

    // ---- linkLocalPackages (dryRun + real-symlink skip detection)

    {
      name: 'linkLocalPackages plans the WHOLE brand tree: sibling targets included (cp194)',
      run: async (ctx) => {
        const site = path.join(FIXTURES, 'brand', 'targets', 'site');
        const actions = await local.linkLocalPackages({ dir: site, monorepoRoot: FAKE_MONOREPO, dryRun: true });
        ctx.expect(actions.map(({ name, action }) => ({ name, action }))).toEqual([
            { name: '@omega.js/backend', action: 'missing' }, // sibling target scanned too — npm resolves the whole workspace tree
            { name: '@omega.js/client', action: 'link' },     // fake monorepo has packages/client
            { name: '@omega.js/web', action: 'missing' },     // ...but no packages/web
          ]);
      },
    },

    {
      name: 'linkLocalPackages skips deps already resolving to the monorepo copy under its file: spec',
      run: async (ctx) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-local-test-'));
        try {
          const clientSpec = `file:${path.relative(fs.realpathSync(scratch), fs.realpathSync(path.join(FAKE_MONOREPO, 'packages', 'client'))).split(path.sep).join('/')}`;
          fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({
            name: 'scratch-target',
            dependencies: { '@omega.js/client': clientSpec },
          }));
          fs.mkdirSync(path.join(scratch, 'node_modules', '@omega.js'), { recursive: true });
          fs.symlinkSync(path.join(FAKE_MONOREPO, 'packages', 'client'), path.join(scratch, 'node_modules', '@omega.js', 'client'));

          const actions = await local.linkLocalPackages({ dir: scratch, monorepoRoot: FAKE_MONOREPO, dryRun: true });
          ctx.expect(actions.map(({ name, action }) => ({ name, action }))).toEqual([
            { name: '@omega.js/client', action: 'skip' },
          ]);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'linkLocalPackages flips a registry pin even when a parent node_modules already resolves local',
      run: async (ctx) => {
        // An in-repo brand resolves every @omega.js package through the monorepo
        // root's workspace links, so the tree alone must never excuse a registry pin.
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-local-pin-'));
        try {
          const webPackage = path.join(scratch, 'packages', 'web');
          fs.mkdirSync(webPackage, { recursive: true });
          fs.writeFileSync(path.join(webPackage, 'package.json'), JSON.stringify({ name: '@omega.js/web', version: '0.51.0' }));
          fs.mkdirSync(path.join(scratch, 'node_modules', '@omega.js'), { recursive: true });
          fs.symlinkSync(webPackage, path.join(scratch, 'node_modules', '@omega.js', 'web'));

          const brand = path.join(scratch, 'brands', 'x');
          const webTarget = path.join(brand, 'targets', 'web');
          fs.mkdirSync(webTarget, { recursive: true });
          fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({
            name: 'x', private: true, workspaces: ['targets/*'],
          }));
          fs.writeFileSync(path.join(webTarget, 'package.json'), JSON.stringify({
            name: 'x-web', private: true, dependencies: { '@omega.js/web': '0.51.0' },
          }));

          const actions = await local.linkLocalPackages({ dir: webTarget, monorepoRoot: scratch, dryRun: true });
          ctx.expect(actions.map(({ name, action }) => ({ name, action }))).toEqual([
            { name: '@omega.js/web', action: 'link' },
          ]);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'linkLocalPackages links a fresh outside brand with ONE real install — unpublished sibling specs cannot 404 (cp194)',
      run: async (ctx) => {
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
          ctx.expect(actions.map(({ name, action }) => ({ name, action }))).toEqual([
            { name: '@omega.js/client', action: 'link' },
            { name: '@omega.js/devkit', action: 'link' },
          ]);

          // Specs flipped in place, placement preserved
          const pkgA = JSON.parse(fs.readFileSync(path.join(targetA, 'package.json'), 'utf8'));
          const pkgB = JSON.parse(fs.readFileSync(path.join(targetB, 'package.json'), 'utf8'));
          ctx.expect(pkgA.dependencies['@omega.js/client'], 'app-a dep flipped to file:').toMatch(/^file:/);
          ctx.expect(pkgB.devDependencies['@omega.js/devkit'], 'app-b devDep flipped to file: in place').toMatch(/^file:/);

          // The one real install materialized links for BOTH targets (hoisted)
          ctx.expect(fs.realpathSync(path.join(scratch, 'node_modules', '@omega.js', 'client')), 'client resolves to the monorepo copy').toBe(fs.realpathSync(path.join(FAKE_MONOREPO, 'packages', 'client')));
          ctx.expect(fs.realpathSync(path.join(scratch, 'node_modules', '@omega.js', 'devkit')), 'sibling devkit resolves to the monorepo copy').toBe(fs.realpathSync(path.join(FAKE_MONOREPO, 'packages', 'devkit')));

          // Rerun converges: everything skips, no manifest churn
          const before = fs.readFileSync(path.join(targetA, 'package.json'), 'utf8');
          const again = await local.linkLocalPackages({ dir: targetA, monorepoRoot: FAKE_MONOREPO });
          ctx.expect(again.map(({ action }) => action), 'second run all-skip').toEqual(['skip', 'skip']);
          ctx.expect(fs.readFileSync(path.join(targetA, 'package.json'), 'utf8'), 'no rewrite on rerun').toBe(before);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    // ---- Watch lock

    {
      name: 'acquireWatchLock takes, holds, and releases the single-instance lock',
      run: (ctx) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lock-test-'));
        try {
          const first = local.acquireWatchLock(scratch);
          ctx.expect(first).toEqual({ acquired: true, pid: process.pid });
          ctx.expect(fs.existsSync(path.join(scratch, local.WATCH_LOCK))).toBe(true);

          // Second take fails while the (live) owner holds it
          const second = local.acquireWatchLock(scratch);
          ctx.expect(second).toEqual({ acquired: false, pid: process.pid });

          local.releaseWatchLock(scratch);
          ctx.expect(fs.existsSync(path.join(scratch, local.WATCH_LOCK))).toBe(false);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a stale lock (dead pid) is cleared and re-acquirable',
      run: (ctx) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lock-test-'));
        try {
          // A real pid that is guaranteed dead: a child that has already exited
          const dead = spawnSync(process.execPath, ['-e', '']);
          const lockPath = path.join(scratch, local.WATCH_LOCK);
          fs.mkdirSync(path.dirname(lockPath), { recursive: true });
          fs.writeFileSync(lockPath, JSON.stringify({ pid: dead.pid }));

          ctx.expect(local.readLiveWatchPid(scratch)).toBe(null);
          ctx.expect(fs.existsSync(lockPath)).toBe(false); // stale lock swept
          ctx.expect(local.acquireWatchLock(scratch).acquired).toBe(true);
          local.releaseWatchLock(scratch);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#587: resolveLinkedMonorepo names the checkout a brand resolves INTO',
      run: (ctx) => {
        const { scratch, brandRoot, monorepoRoot } = stageLinkedBrand('monorepo');
        try {
          ctx.expect(local.resolveLinkedMonorepo(brandRoot)).toBe(monorepoRoot);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#587: a registry-installed brand resolves into no monorepo at all',
      run: (ctx) => {
        const { scratch, brandRoot } = stageLinkedBrand('registry');
        try {
          ctx.expect(local.resolveLinkedMonorepo(brandRoot)).toBe(null);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'startMonorepoWatch declines to double-start when the lock is held',
      run: async (ctx) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lock-test-'));
        try {
          local.acquireWatchLock(scratch); // held by us — a live process
          const { ready, ...result } = local.startMonorepoWatch({ monorepoRoot: scratch });
          ctx.expect(result).toEqual({ alreadyRunning: true, pid: process.pid, child: null });
          await ready; // no initial prepare of our own to wait for (#670)
          local.releaseWatchLock(scratch);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    // The pass/debounce/coalesce logic is tested through poke() — the documented
    // seam the real fs watchers feed (macOS FSEvents streams activate
    // asynchronously, so a write landing right after fs.watch() can be lost;
    // the one integration test below covers the fs layer flake-free).

    {
      name: 'startVendorPropagation watches only packages with an existing src/',
      run: (ctx) => {
        const { scratch, packagesDir } = vendorScratch();
        const propagation = local.startVendorPropagation({
          packagesDir,
          packages: ['devkit', 'config', 'account'], // only devkit/src exists in the scratch
          dependents: [],
        });
        try {
          ctx.expect(propagation.watched).toEqual(['devkit']);
        } finally {
          propagation.close();
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a change re-prepares every dependent, in order',
      run: async (ctx) => {
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
          ctx.expect(calls).toEqual(['backend', 'client']);
        } finally {
          propagation.close();
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'rapid changes inside the debounce window coalesce into one pass',
      run: async (ctx) => {
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
          ctx.expect(calls).toEqual(['backend']);
        } finally {
          propagation.close();
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a change landing mid-pass queues exactly one follow-up pass',
      run: async (ctx) => {
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
          ctx.expect(calls.length).toBe(2);
        } finally {
          propagation.close();
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a failing prepare is contained — the rest of the pass still runs',
      run: async (ctx) => {
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
          ctx.expect(calls).toEqual(['backend', 'client']);
          ctx.expect(logs.some((line) => line.includes('backend') && line.includes('boom')), 'failure surfaced in the log').toBeTruthy();
        } finally {
          propagation.close();
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'close() stops the watch — later changes trigger nothing',
      run: async (ctx) => {
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
          ctx.expect(calls).toEqual([]);
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'the real fs watch feeds the same pipeline (recursive, by package name)',
      run: async (ctx) => {
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
          ctx.expect(calls.length >= 2, 'at least one full pass ran').toBeTruthy();
          for (let i = 0; i + 1 < calls.length; i += 2) {
            ctx.expect(calls.slice(i, i + 2), `pass ${i / 2} covers both dependents in order`).toEqual(['backend', 'client']);
          }
        } finally {
          propagation.close();
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    // ---- restoreRegistrySpecs (the publish-day inverse)

    {
      name: 'restoreRegistrySpecs plans the linked version for file: specs and skips registry specs',
      run: async (ctx) => {
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
          ctx.expect(actions.map(({ name, spec, action }) => ({ name, spec, action }))).toEqual([
            { name: '@omega.js/client', spec: '0.1.0', action: 'flip' },
            { name: '@omega.js/web', spec: '^0.1.0', action: 'skip' },
          ]);

          // Explicit range override wins over the derived version, verbatim
          const overridden = await local.restoreRegistrySpecs({ dir: targetDir, dryRun: true, range: '^0.2.0' });
          ctx.expect(overridden.find((action) => action.name === '@omega.js/client').spec).toBe('^0.2.0');

          // dryRun writes nothing — the file: spec survives verbatim
          const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8'));
          ctx.expect(manifest.dependencies['@omega.js/client'].startsWith('file:')).toBeTruthy();
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'restoreRegistrySpecs writes the EXACT version, never a caret (#794 lockstep)',
      run: async (ctx) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-restore-exact-'));
        try {
          const pkgDir = path.join(scratch, 'monorepo', 'packages', 'client');
          fs.mkdirSync(pkgDir, { recursive: true });
          fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@omega.js/client', version: '0.3.0' }));

          const brand = path.join(scratch, 'brand');
          const targetDir = path.join(brand, 'targets', 'site');
          fs.mkdirSync(targetDir, { recursive: true });
          fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({ name: 'brand', private: true, workspaces: ['targets/*'] }));
          fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({
            name: 'site',
            dependencies: {
              '@omega.js/client': `file:${path.relative(targetDir, pkgDir).split(path.sep).join('/')}`,
            },
          }));

          // The plan carries the bare version — a caret would let this target float
          // ahead of its siblings the moment the family releases again
          const planned = await local.restoreRegistrySpecs({ dir: targetDir, dryRun: true });
          ctx.expect(planned.map(({ name, spec, action }) => ({ name, spec, action }))).toEqual([
            { name: '@omega.js/client', spec: '0.3.0', action: 'flip' },
          ]);

          // The planned spec IS the string the flip writes (setDependencySpec takes
          // it verbatim); the write leg itself stays out of this test because its
          // install resolves the family from the REGISTRY, which no offline run can
          // do for an unpublished version.

          // An explicit range still wins verbatim — the caller owns that string
          const overridden = await local.restoreRegistrySpecs({ dir: targetDir, dryRun: true, range: '^9.9.9' });
          ctx.expect(overridden.find((action) => action.name === '@omega.js/client').spec).toBe('^9.9.9');
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#938: linkLocalPackages writes the BRAND\'s own lockfile when the brand sits inside an outer workspace',
      run: async (ctx) => {
        const { scratch, outer, brand, targetA } = makeNestedBrand({ '@omega.js/client': '*' });
        try {
          await local.linkLocalPackages({ dir: targetA, monorepoRoot: FAKE_MONOREPO });

          const spec = JSON.parse(fs.readFileSync(path.join(targetA, 'package.json'), 'utf8')).dependencies['@omega.js/client'];
          const lock = JSON.parse(fs.readFileSync(path.join(brand, 'package-lock.json'), 'utf8'));
          const expectedLink = path.relative(brand, fs.realpathSync(path.join(FAKE_MONOREPO, 'packages', 'client'))).split(path.sep).join('/');

          ctx.expect(lock.packages['node_modules/@omega.js/client'].link, 'the brand lock carries the link').toBe(true);
          ctx.expect(lock.packages['node_modules/@omega.js/client'].resolved).toBe(expectedLink);
          ctx.expect(lock.packages['targets/target-a'].dependencies['@omega.js/client'], 'and records the flipped spec').toBe(spec);
          ctx.expect(fs.existsSync(path.join(outer, 'package-lock.json')), 'npm still wrote the outer lock (the climb the helper answers)').toBeTruthy();
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#938: restoreRegistrySpecs regenerates the BRAND\'s lockfile, dropping the stale link npm would otherwise keep',
      run: async (ctx) => {
        const { scratch, brand, targetA } = makeLinkedBrand();

        try {
          await withRegistry(ctx.expect, scratch, async ({ url }) => {
            const actions = await local.restoreRegistrySpecs({ dir: targetA });
            ctx.expect(actions.map(({ name, spec, action }) => ({ name, spec, action }))).toEqual([
              { name: '@omega.js/client', spec: '0.1.0', action: 'flip' },
            ]);

            const lock = JSON.parse(fs.readFileSync(path.join(brand, 'package-lock.json'), 'utf8'));
            const entry = lock.packages['node_modules/@omega.js/client'];
            ctx.expect(entry.link, 'no link left').toBe(undefined);
            ctx.expect(entry.version).toBe('0.1.0');
            ctx.expect(entry.resolved, 'resolved from the registry').toBe(`${url}/client-0.1.0.tgz`);
            ctx.expect(lock.packages['../../linked-client'], 'the link target entry is gone too').toBe(undefined);
            ctx.expect(() => assertBrandLockfile({ root: brand }), 'the deploy gate accepts it').not.toThrow();
          });
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#862: restoreRegistrySpecs prunes the lock BEFORE the install, so no @omega.js package stays linked',
      run: async (ctx) => {
        // A STANDALONE brand (the real consumer topology): nested, npm's tree install
        // climbs to the outer root and never writes the brand's node_modules at all.
        const { scratch, outer, brand, targetA } = makeLinkedBrand();
        fs.rmSync(path.join(outer, 'package.json'));

        try {
          await withRegistry(ctx.expect, scratch, async () => {
            await local.restoreRegistrySpecs({ dir: targetA });

            const installed = path.join(brand, 'node_modules/@omega.js/client');
            ctx.expect(fs.lstatSync(installed).isSymbolicLink(), `${installed} is still a link`).toBe(false);
            ctx.expect(local.resolveLinkedMonorepo(brand)).toBe(null);
          });
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#862: restoreRegistrySpecs with nothing to flip fails loudly on a tree that is still linked',
      run: async (ctx) => {
        // The playground's real failure shape: registry specs, a registry lock, and
        // a node_modules copy that is still a symlink into the checkout.
        const { scratch, outer, brand, targetA, linked } = makeLinkedBrand();
        fs.rmSync(path.join(outer, 'package.json'));

        try {
          await withRegistry(ctx.expect, scratch, async () => {
            await local.restoreRegistrySpecs({ dir: targetA });

            const installed = path.join(brand, 'node_modules/@omega.js/client');
            fs.rmSync(installed, { recursive: true });
            fs.symlinkSync(linked, installed);

            await ctx.expect(local.restoreRegistrySpecs({ dir: targetA })).rejects.toThrow({ message: `omega i live left ${installed} linked into ${linked}` });
            // A plan writes nothing, so it verifies nothing
            await local.restoreRegistrySpecs({ dir: targetA, dryRun: true });
          });
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#938: restoreRegistrySpecs with nothing to flip still heals a lock that disagrees, and leaves an agreeing one alone',
      run: async (ctx) => {
        // The playground's state after the first 0.51.0 flip: registry specs, and a
        // brand lock that still says link. `omega i live` is the fix the gate names,
        // so it has to work here too.
        const { scratch, brand, targetA } = makeNestedBrand({ '@omega.js/client': '0.1.0' });
        const linked = path.join(scratch, 'linked-client');
        fs.mkdirSync(linked, { recursive: true });
        fs.writeFileSync(path.join(linked, 'package.json'), JSON.stringify({ name: '@omega.js/client', version: '0.1.0' }));
        writeStaleLinkLock(brand, '../../linked-client');

        try {
          await withRegistry(ctx.expect, scratch, async ({ url, requests }) => {
            const actions = await local.restoreRegistrySpecs({ dir: targetA });
            ctx.expect(actions.map(({ action }) => action)).toEqual(['skip']);
            const lock = JSON.parse(fs.readFileSync(path.join(brand, 'package-lock.json'), 'utf8'));
            ctx.expect(lock.packages['node_modules/@omega.js/client'].resolved).toBe(`${url}/client-0.1.0.tgz`);
            ctx.expect(() => assertBrandLockfile({ root: brand })).not.toThrow();

            // A rerun on the healed lock asks npm nothing at all
            requests.length = 0;
            const before = fs.readFileSync(path.join(brand, 'package-lock.json'), 'utf8');
            await local.restoreRegistrySpecs({ dir: targetA });
            ctx.expect(requests, 'no registry call on an agreeing lock').toEqual([]);
            ctx.expect(fs.readFileSync(path.join(brand, 'package-lock.json'), 'utf8')).toBe(before);
          });
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#938: regenerateLockfile prunes a STALE workspace entry (a renamed target) so npm cannot re-create the link it declares',
      run: async (ctx) => {
        // The playground's real shape: `targets/website` was renamed to `targets/web`,
        // and the lock still carries the old folder's entry declaring the local-era
        // `file:` spec. npm's lock-only run honors that entry and links it again.
        const { scratch, brand } = makeNestedBrand({ '@omega.js/client': '0.1.0' });
        const linked = path.join(scratch, 'linked-client');
        fs.mkdirSync(linked, { recursive: true });
        fs.writeFileSync(path.join(linked, 'package.json'), JSON.stringify({ name: '@omega.js/client', version: '0.1.0' }));
        fs.writeFileSync(path.join(brand, 'package-lock.json'), JSON.stringify({
          name: 'nested-brand',
          lockfileVersion: 3,
          requires: true,
          packages: {
            '': { name: 'nested-brand', workspaces: ['targets/*'] },
            '../../linked-client': { name: '@omega.js/client', version: '0.1.0' },
            'node_modules/@omega.js/client': { resolved: '../../linked-client', link: true },
            'node_modules/nested-target-a': { resolved: 'targets/target-a', link: true },
            'node_modules/old-website': { resolved: 'targets/website', link: true },
            'targets/target-a': { name: 'nested-target-a', dependencies: { '@omega.js/client': '0.1.0' } },
            'targets/website': { name: 'old-website', extraneous: true, dependencies: { '@omega.js/client': 'file:../../../../linked-client' } },
            'targets/website/node_modules/left-pad': { version: '1.3.0', extraneous: true },
          },
        }, null, 2));

        try {
          await withRegistry(ctx.expect, scratch, async ({ url }) => {
            const lines = [];
            await regenerateLockfile({ root: brand, log: (line) => lines.push(line) });

            const lock = JSON.parse(fs.readFileSync(path.join(brand, 'package-lock.json'), 'utf8'));
            ctx.expect(lock.packages['node_modules/@omega.js/client'].link, 'no link re-created').toBe(undefined);
            ctx.expect(lock.packages['node_modules/@omega.js/client'].resolved).toBe(`${url}/client-0.1.0.tgz`);
            ctx.expect(lock.packages['targets/website'], 'the stale workspace entry is gone').toBe(undefined);
            ctx.expect(lock.packages['targets/website/node_modules/left-pad'], 'and everything under it').toBe(undefined);
            ctx.expect(lock.packages['node_modules/old-website'], 'and the link that pointed at it').toBe(undefined);
            ctx.expect(lock.packages['targets/target-a'], 'the live workspace stays').toBeTruthy();
            ctx.expect(lines.some((line) => line.includes('targets/website')), `the prune is logged (got ${JSON.stringify(lines)})`).toBeTruthy();
            ctx.expect(() => assertBrandLockfile({ root: brand })).not.toThrow();
          });
        } finally {
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },
  ],
});
