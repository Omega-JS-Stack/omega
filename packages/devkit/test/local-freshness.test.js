// Unit tests for src/local.js ensureFreshLocalDist/freshnessBoot — the
// local-dist freshness guard: detect a stale linked dist at CLI boot, heal a
// plain local checkout, and STOP on a monorepo link whose watch is running,
// because that watch owns the build (#281) — with the watch down the boot heals
// that link too, since nothing else will (#398).
//
// Real-execution only (no mocks): every scenario runs against a scratch
// package on disk, and the rebuild path spawns the fixture's REAL
// `npm run prepare` (offline — the prepare script is a local node build).
// Staleness is driven with explicit utimes, never sleeps.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const local = require('../src/local');

const PKG_NAME = '@scratch/pkg';

// The guard's env seams leak across tests (and CI may set the skip hatch for
// OTHER harnesses) — every test here starts with both cleared.
const beforeEachHook = () => {
  delete process.env.OMEGA_SKIP_FRESHNESS;
  delete process.env.OMEGA_FRESH_REEXEC;
};

/** Fresh scratch dir (real path — macOS /var is a symlink), cleaned after the test. */
function makeScratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-freshness-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Set every file and directory under dir (inclusive) to the given epoch seconds. */
function setTreeTimes(dir, seconds) {
  const when = new Date(seconds * 1000);
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else {
        fs.utimesSync(abs, when, when);
      }
    }
    fs.utimesSync(current, when, when);
  }
}

/**
 * Write a buildable scratch package: src/, dist/ (unless withDist=false), and
 * a REAL prepare script (node build.js — copies src→dist, appends a line to
 * builds.log and writes a dist/vendor/built.txt sentinel, modelling the vendor
 * hook's post-copy write) unless withPrepare=false.
 * @param {object} [options.manifest] - Extra package.json fields (e.g. omega.vendorAssets).
 * @param {number} [options.buildMs] - Make the build take this long (concurrency probes).
 * @param {number} [options.holdPurgeMs] - Hold the build WITH dist purged for this
 *   long, writing purged.marker first — the window a sibling process requires
 *   into (#340). Zero (default) purges and recopies back to back.
 */
function makePkg(dir, options = {}) {
  const { withPrepare = true, withDist = true, manifest = {}, buildMs = 0, holdPurgeMs = 0 } = options;

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: PKG_NAME,
    version: '0.0.0',
    scripts: withPrepare ? { prepare: 'node build.js' } : {},
    ...manifest,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'build.js'), [
    "const fs = require('fs');",
    "const path = require('path');",
    "const dist = path.join(__dirname, 'dist');",
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${buildMs});`,
    "fs.appendFileSync(path.join(__dirname, 'builds.log'), process.pid + '\\n');",
    'fs.rmSync(dist, { recursive: true, force: true });',
    ...(holdPurgeMs > 0 ? [
      "fs.writeFileSync(path.join(__dirname, 'purged.marker'), String(Date.now()));",
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${holdPurgeMs});`,
    ] : []),
    "fs.cpSync(path.join(__dirname, 'src'), dist, { recursive: true });",
    "fs.mkdirSync(path.join(dist, 'vendor'), { recursive: true });",
    "fs.writeFileSync(path.join(dist, 'vendor', 'built.txt'), String(Date.now()));",
    '',
  ].join('\n'));
  if (withDist) {
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'module.exports = 1;\n');
  }
}

/** The scratch prepare's sentinel — written where the vendor hook writes. */
function builtSentinel(pkgDir) {
  return path.join(pkgDir, 'dist', 'vendor', 'built.txt');
}

/** How many times the scratch prepare ran. */
function buildCount(pkgDir) {
  try {
    return fs.readFileSync(path.join(pkgDir, 'builds.log'), 'utf8').trim().split('\n').length;
  } catch (e) {
    return 0;
  }
}

/** Write the monorepo watch lock, owned by pid (default: this live process). */
function writeWatchLock(root, pid = process.pid) {
  fs.mkdirSync(path.join(root, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(root, '.omega', 'dev-watch.lock'), JSON.stringify({ pid }));
}

/** Consumer dir whose node_modules/@scratch/pkg SYMLINKS to pkgDir (a local link). */
function makeConsumer(dir, pkgDir) {
  fs.mkdirSync(path.join(dir, 'node_modules', '@scratch'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'consumer', version: '0.0.0' })}\n`);
  fs.symlinkSync(pkgDir, path.join(dir, 'node_modules', '@scratch', 'pkg'), 'dir');
}

/** A buildable scratch package under a chosen name, optionally with @omega.js deps. */
function makeOmegaPkg(dir, name, dependencies, devDependencies) {
  const manifest = { name };
  if (dependencies) {
    manifest.dependencies = dependencies;
  }
  if (devDependencies) {
    manifest.devDependencies = devDependencies;
  }
  makePkg(dir, { manifest });
}

/** Symlink pkgDir into dir's node_modules under its package name (a local link). */
function linkPkg(dir, name, pkgDir) {
  const target = path.join(dir, 'node_modules', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(pkgDir, target, 'dir');
}

/** A consumer dir with nothing linked yet (linkPkg adds the links). */
function makeConsumerRoot(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'consumer', version: '0.0.0' })}\n`);
}

/** Fake monorepo root recognized by isMonorepoRoot, with a devkit src to age. */
function makeFakeMonorepo(root) {
  fs.mkdirSync(path.join(root, 'packages', 'devkit', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'omega', version: '0.0.0' })}\n`);
  fs.writeFileSync(path.join(root, 'packages', 'devkit', 'package.json'), `${JSON.stringify({ name: '@omega.js/devkit', version: '0.0.0' })}\n`);
  fs.writeFileSync(path.join(root, 'packages', 'devkit', 'src', 'index.js'), 'module.exports = 1;\n');
}

// ---- declared vendorAssets: the exemption is not a free pass (#199)

// @omega.js-scoped like the real declarations — the staleness loop skips
// foreign scopes outright (their short name can't map to packages/<name>)
const ASSET_SOURCE = '@omega.js/web';

/** The fake monorepo's asset-source package — where a vendorAssets `from` resolves. */
function sourcePkgDir(root) {
  return path.join(root, 'packages', 'web');
}

/** Write an asset (with its dirs) in the source package a vendorAssets entry names. */
function writeSourceAsset(root, relative) {
  const abs = path.join(sourcePkgDir(root), relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'source\n');
  fs.writeFileSync(path.join(sourcePkgDir(root), 'package.json'), `${JSON.stringify({ name: ASSET_SOURCE, version: '0.0.0' })}\n`);
}

/** Write the vendored dist copy (with its dirs) the vendor hook would have made. */
function writeVendoredCopy(pkgDir, relative) {
  const abs = path.join(pkgDir, 'dist', relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'vendored\n');
}

// ---- the boot walk: the host AND its @omega.js/* runtime deps (#198)

const HOST_NAME = '@omega.js/scratch-host';
const DEP_NAME = '@omega.js/scratch-dep';
const GRANDDEP_NAME = '@omega.js/scratch-granddep';
const DEVDEP_NAME = '@omega.js/scratch-devdep';

/** Write and run the wired CLI (freshnessBoot, then the "command") in consumer. */
function runWiredCli(consumer, packageName) {
  const cliPath = path.join(consumer, 'cli.js');
  fs.writeFileSync(cliPath, [
    `const local = require(${JSON.stringify(require.resolve('../src/local'))});`,
    `const result = local.freshnessBoot({ packageName: ${JSON.stringify(packageName)}, fromDir: __dirname });`,
    "console.log('STATUS ' + result.status);",
    "console.log('CLI_RAN reexec=' + (process.env.OMEGA_FRESH_REEXEC || '0'));",
    '',
  ].join('\n'));

  const env = Object.assign({}, process.env);
  delete env.OMEGA_SKIP_FRESHNESS;
  delete env.OMEGA_FRESH_REEXEC;
  return spawnSync(process.execPath, [cliPath], { cwd: consumer, env, encoding: 'utf8' });
}

// ---- the fan-out sweep: ONE check pass, before any lane spawns (#340)

const HOST_B_NAME = '@omega.js/scratch-host-b';

/** Two lane hosts sharing one dep, each linked into its own target dir. */
function makeFanOut(scratch) {
  const hostA = path.join(scratch, 'host-a');
  const hostB = path.join(scratch, 'host-b');
  const depDir = path.join(scratch, 'dep');
  const targetA = path.join(scratch, 'target-a');
  const targetB = path.join(scratch, 'target-b');

  makeOmegaPkg(hostA, HOST_NAME, { [DEP_NAME]: '*' });
  makeOmegaPkg(hostB, HOST_B_NAME, { [DEP_NAME]: '*' });
  makeOmegaPkg(depDir, DEP_NAME);
  linkPkg(hostA, DEP_NAME, depDir);
  linkPkg(hostB, DEP_NAME, depDir);
  makeConsumerRoot(targetA);
  linkPkg(targetA, HOST_NAME, hostA);
  makeConsumerRoot(targetB);
  linkPkg(targetB, HOST_B_NAME, hostB);

  return {
    depDir,
    hosts: [{ packageName: HOST_NAME, fromDir: targetA }, { packageName: HOST_B_NAME, fromDir: targetB }],
  };
}

/** Run fn with console.error captured; returns the joined output. */
function captureError(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines.join('\n');
}

// ---- the fan-out race the sweep closes (#340)

/**
 * A lane entry point shaped like a framework bin: the dispatcher hop
 * (`require('../dist/…')`, the require that died mid-purge) then the CLI's own
 * freshness boot.
 */
function writeLaneBin(pkgDir, consumer) {
  const binDir = path.join(pkgDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, 'lane.js');
  fs.writeFileSync(binPath, [
    "require('../dist/index.js');",
    `const local = require(${JSON.stringify(require.resolve('../src/local'))});`,
    `local.freshnessBoot({ packageName: ${JSON.stringify(PKG_NAME)}, fromDir: ${JSON.stringify(consumer)} });`,
    "console.log('LANE_OK');",
    '',
  ].join('\n'));
  return binPath;
}

/** Spawn a lane, resolving to its exit status and streams. */
function runLane(binPath, consumer) {
  const env = Object.assign({}, process.env);
  delete env.OMEGA_SKIP_FRESHNESS;
  delete env.OMEGA_FRESH_REEXEC;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binPath], { cwd: consumer, env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Wait for the build to reach its purged window (or give up after 20s). */
function awaitPurged(pkgDir) {
  const marker = path.join(pkgDir, 'purged.marker');
  const deadline = Date.now() + 20000;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(marker)) {
        resolve();
      } else if (Date.now() >= deadline) {
        reject(new Error('the fixture build never reached its purged window'));
      } else {
        setTimeout(poll, 20);
      }
    };
    poll();
  });
}

/** A stale local checkout with a lane bin, linked into one consumer. */
function stageLanes(t) {
  const scratch = makeScratch(t);
  const pkgDir = path.join(scratch, 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makePkg(pkgDir, { holdPurgeMs: 3000 }); // the purge window, held open
  makeConsumer(consumer, pkgDir);
  const binPath = writeLaneBin(pkgDir, consumer);
  setTreeTimes(path.join(pkgDir, 'dist'), 1000);
  setTreeTimes(path.join(pkgDir, 'src'), 2000); // stale at boot — the incident's starting state
  return { pkgDir, consumer, binPath };
}

module.exports = defineCases({
  type: 'group',
  description: 'local-freshness',
  tests: [
    // ---- vendorable-list parity pin

    {
      name: 'FRESHNESS_VENDORABLES matches tools/vendor.js VENDORABLE_PACKAGES (the SSOT)',
      run: (ctx) => {
        beforeEachHook();
        ctx.expect(local.FRESHNESS_VENDORABLES).toEqual(require('../tools/vendor').VENDORABLE_PACKAGES);
      },
    },

    // ---- env seams

    {
      name: 'OMEGA_SKIP_FRESHNESS short-circuits to skipped',
      run: (ctx) => {
        beforeEachHook();
        process.env.OMEGA_SKIP_FRESHNESS = '1';
        ctx.expect(local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: makeScratch(ctx) }).status).toBe('skipped');
      },
    },

    {
      name: 'OMEGA_FRESH_REEXEC short-circuits to reexec-guard',
      run: (ctx) => {
        beforeEachHook();
        process.env.OMEGA_FRESH_REEXEC = '1';
        ctx.expect(local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: makeScratch(ctx) }).status).toBe('reexec-guard');
      },
    },

    // ---- resolution shapes

    {
      name: 'a real registry install (realpath inside node_modules) is skipped',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const consumer = path.join(scratch, 'consumer');
        const installed = path.join(consumer, 'node_modules', '@scratch', 'pkg');
        fs.mkdirSync(consumer, { recursive: true });
        fs.writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ name: 'consumer', version: '0.0.0' })}\n`);
        makePkg(installed); // a REAL directory under node_modules, src+prepare and all

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('registry');
      },
    },

    {
      name: 'an unresolvable package (bootstrap dir) is skipped as registry',
      run: (ctx) => {
        beforeEachHook();
        ctx.expect(local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: makeScratch(ctx) }).status).toBe('registry');
      },
    },

    {
      name: 'a linked package without src or prepare is not-buildable',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir, { withPrepare: false });
        makeConsumer(consumer, pkgDir);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('not-buildable');
        ctx.expect(result.dir).toBe(pkgDir);
      },
    },

    // ---- staleness

    {
      name: 'dist newer than src is fresh — no rebuild',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('fresh');
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
      },
    },

    {
      name: 'src newer than dist triggers a real prepare and reports rebuilt',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuilt');
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(true);
      },
    },

    {
      name: 'a missing dist is stale and rebuilds',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir, { withDist: false });
        makeConsumer(consumer, pkgDir);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuilt');
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(true);
      },
    },

    {
      name: 'a stale vendored copy (monorepo package) is stale even with a fresh own-src dist',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        fs.mkdirSync(path.join(pkgDir, 'dist', 'vendor', 'devkit'), { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'dist', 'vendor', 'devkit', 'index.js'), 'module.exports = 1;\n');
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000); // own dist fresh
        setTreeTimes(path.join(pkgDir, 'dist', 'vendor', 'devkit'), 1500);
        setTreeTimes(path.join(root, 'packages', 'devkit', 'src'), 2500); // devkit edited after the vendor copy
        writeWatchLock(root);

        // A monorepo link under a live watch: detected, reported, and left alone (#281)
        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('stale-linked');
        ctx.expect(result.reason).toBe('dist/vendor/devkit is older than packages/devkit/src');
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
      },
    },

    // ---- per-file evidence (#195: the whole-tree mtime compare could be fooled)

    {
      name: 'a newer vendor write inside dist no longer masks a src file dist never got',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        // The 2026-08-05 shape: a new src file that never reached dist, and a vendor
        // hook write landing in dist AFTER it — the newest dist mtime out-runs the
        // newest src mtime, so the old whole-tree compare read FRESH.
        fs.writeFileSync(path.join(pkgDir, 'src', 'new.js'), 'module.exports = 2;\n');
        fs.mkdirSync(path.join(pkgDir, 'dist', 'vendor', 'devkit'), { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'dist', 'vendor', 'devkit', 'index.js'), 'module.exports = 1;\n');
        setTreeTimes(path.join(pkgDir, 'src'), 2000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000);
        setTreeTimes(path.join(pkgDir, 'dist', 'vendor', 'devkit'), 3000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuilt');
        ctx.expect(fs.existsSync(path.join(pkgDir, 'dist', 'new.js'))).toBe(true);
      },
    },

    {
      name: 'a src file missing its dist counterpart is stale regardless of mtimes',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        fs.mkdirSync(path.join(pkgDir, 'src', 'commands'), { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'src', 'commands', 'setup.js'), 'module.exports = 3;\n');
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 5000); // every existing dist file is newer

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuilt');
        ctx.expect(fs.existsSync(path.join(pkgDir, 'dist', 'commands', 'setup.js'))).toBe(true);
      },
    },

    {
      name: 'a dist leftover from a deleted src file is stale',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        fs.writeFileSync(path.join(pkgDir, 'dist', 'removed.js'), 'module.exports = 4;\n'); // src copy deleted
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuilt');
        ctx.expect(fs.existsSync(path.join(pkgDir, 'dist', 'removed.js'))).toBe(false);
      },
    },

    {
      name: 'runtime-mutable state under dist/test/fixtures/ is never an orphan (#352)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        // What a backend self-test run seeds into its fixture project: gitignored
        // files with no src counterpart, still there after a crashed run.
        const seeded = path.join(pkgDir, 'dist', 'test', 'fixtures', 'firebase-project', 'firestore.rules');
        fs.mkdirSync(path.dirname(seeded), { recursive: true });
        fs.writeFileSync(seeded, "rules_version = '2';\n");
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('fresh');
        ctx.expect(fs.existsSync(seeded)).toBe(true);
      },
    },

    {
      name: 'the fixture-state exemption is narrow — an extra dist/test/ file outside fixtures is stale',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        const leftover = path.join(pkgDir, 'dist', 'test', 'runner.js');
        fs.mkdirSync(path.dirname(leftover), { recursive: true });
        fs.writeFileSync(leftover, 'module.exports = 5;\n'); // src copy deleted
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuilt');
        ctx.expect(fs.existsSync(leftover)).toBe(false);
      },
    },

    {
      name: 'the extras prepare generates (vendor, declared assets) stay fresh',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir, {
          manifest: { omega: { vendorAssets: [{ package: '@scratch/other', from: 'themes', to: 'assets/themes' }] } },
        });
        makeConsumer(consumer, pkgDir);
        for (const extra of ['vendor/devkit/logger.js', 'assets/themes/classy/theme.scss']) {
          const abs = path.join(pkgDir, 'dist', extra);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, 'generated\n');
        }
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('fresh');
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
      },
    },

    {
      name: 'a dist/docs or dist/package.json leftover is stale — nothing generates them in dist',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        // vendor-docs writes the package ROOT docs/ and prepare-package rewrites the
        // ROOT package.json — a copy inside dist is a leftover like any other
        for (const leftover of ['docs/index.md', 'package.json']) {
          const abs = path.join(pkgDir, 'dist', leftover);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, 'left over\n');
        }
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuilt');
        ctx.expect(fs.existsSync(path.join(pkgDir, 'dist', 'package.json'))).toBe(false);
        ctx.expect(fs.existsSync(path.join(pkgDir, 'dist', 'docs'))).toBe(false);
      },
    },

    {
      name: 'a vendorAssets source newer than its vendored dist copy is stale',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir, {
          manifest: { omega: { vendorAssets: [{ package: ASSET_SOURCE, from: 'themes', to: 'assets/themes' }] } },
        });
        makeConsumer(consumer, pkgDir);
        writeVendoredCopy(pkgDir, 'assets/themes/classy/theme.scss');
        writeSourceAsset(root, 'themes/classy/theme.scss');
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000); // own dist fresh, copy and all
        setTreeTimes(sourcePkgDir(root), 3000); // the theme edited after the copy
        writeWatchLock(root);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('stale-linked'); // a monorepo link under a live watch: reported, never built here (#281)
        ctx.expect(result.reason).toBe(`dist/assets/themes is older than ${ASSET_SOURCE}'s themes`);
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
      },
    },

    {
      name: 'a vendorAssets source older than its vendored dist copy is fresh',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir, {
          manifest: { omega: { vendorAssets: [{ package: ASSET_SOURCE, from: 'themes', to: 'assets/themes' }] } },
        });
        makeConsumer(consumer, pkgDir);
        writeVendoredCopy(pkgDir, 'assets/themes/classy/theme.scss');
        writeSourceAsset(root, 'themes/classy/theme.scss');
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 3000); // vendored after the source
        setTreeTimes(sourcePkgDir(root), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('fresh');
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
      },
    },

    {
      name: 'a single-FILE vendorAssets entry compares that file, not a tree',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir, {
          manifest: {
            omega: {
              vendorAssets: [{ package: ASSET_SOURCE, from: 'core/js/core/app-shell.js', to: 'assets/js/app-shell.js' }],
            },
          },
        });
        makeConsumer(consumer, pkgDir);
        writeVendoredCopy(pkgDir, 'assets/js/app-shell.js');
        writeSourceAsset(root, 'core/js/core/app-shell.js');
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000);
        setTreeTimes(sourcePkgDir(root), 3000); // the one file edited after the copy
        writeWatchLock(root);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('stale-linked');
        ctx.expect(result.reason).toBe(`dist/assets/js/app-shell.js is older than ${ASSET_SOURCE}'s core/js/core/app-shell.js`);
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
      },
    },

    {
      name: 'a vendorAssets destination that was never vendored is stale',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir, {
          manifest: { omega: { vendorAssets: [{ package: ASSET_SOURCE, from: 'themes', to: 'assets/themes' }] } },
        });
        makeConsumer(consumer, pkgDir);
        writeSourceAsset(root, 'themes/classy/theme.scss');
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 5000); // newer than the source, and still missing the copy
        setTreeTimes(sourcePkgDir(root), 2000);
        writeWatchLock(root);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('stale-linked');
        ctx.expect(result.reason).toBe(`dist/assets/themes was never vendored from ${ASSET_SOURCE}'s themes`);
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
      },
    },

    {
      name: 'a foreign-scope vendorAssets entry is skipped, not mismapped',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir, {
          // Short name 'web' collides with the monorepo dir a real entry maps to —
          // the scope guard must skip it before the packages/web comparison runs
          manifest: { omega: { vendorAssets: [{ package: '@types/web', from: 'themes', to: 'assets/themes' }] } },
        });
        makeConsumer(consumer, pkgDir);
        writeSourceAsset(root, 'themes/classy/theme.scss');
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000); // missing the copy AND older than the source
        setTreeTimes(sourcePkgDir(root), 3000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('fresh');
      },
    },

    // ---- the live watch: bounded grace, then the verdict

    {
      name: 'stale under a live watch lock is reported once the bounded recheck expires',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000); // stale, and no watcher ever copies
        writeWatchLock(root);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('stale-linked'); // the grace expired, and a WATCHED monorepo link is still read-only
        ctx.expect(result.monorepoRoot).toBe(root); // the monorepo whose watch the message says to wait for
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
      },
    },

    {
      name: 'a watcher copy landing inside the grace window is a heal by the watch (rebuilt/watch)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000); // stale
        writeWatchLock(root);

        // A stand-in watcher: a real process that lands the src→dist copy shortly
        // after boot — well inside the grace window, well after the first check.
        const watcherPath = path.join(scratch, 'watcher.js');
        fs.writeFileSync(watcherPath, [
          "const fs = require('fs');",
          `const when = new Date(3000 * 1000);`,
          `setTimeout(() => fs.utimesSync(${JSON.stringify(path.join(pkgDir, 'dist', 'index.js'))}, when, when), 150);`,
          '',
        ].join('\n'));
        const watcher = spawn(process.execPath, [watcherPath], { stdio: 'ignore' });
        ctx.after(() => watcher.kill());

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuilt'); // a heal is a heal — the caller re-execs
        ctx.expect(result.by).toBe('watch');
        ctx.expect(buildCount(pkgDir)).toBe(0); // the watch built it, not us
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
      },
    },

    // ---- the per-package heal lock

    {
      name: 'two CLIs healing the same stale package produce exactly one build',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir, { buildMs: 500 }); // slow enough that the second CLI really contends
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000);

        const cliPath = path.join(consumer, 'cli.js');
        fs.writeFileSync(cliPath, [
          `const local = require(${JSON.stringify(require.resolve('../src/local'))});`,
          `const result = local.ensureFreshLocalDist({ packageName: ${JSON.stringify(PKG_NAME)}, fromDir: __dirname });`,
          "console.log('STATUS ' + result.status + ':' + result.by);",
          '',
        ].join('\n'));

        const env = Object.assign({}, process.env);
        delete env.OMEGA_SKIP_FRESHNESS;
        delete env.OMEGA_FRESH_REEXEC;
        const run = () => new Promise((resolve) => {
          const child = spawn(process.execPath, [cliPath], { cwd: consumer, env });
          let out = '';
          child.stdout.setEncoding('utf8');
          child.stdout.on('data', (chunk) => { out += chunk; });
          child.on('exit', () => resolve((out.match(/STATUS (\S+)/) || [])[1]));
        });

        return Promise.all([run(), run()]).then((statuses) => {
          // The loser re-checked instead of rebuilding — but it booted from the
          // stale dist too, so it reports a heal (by: peer) and re-execs like the winner
          ctx.expect(statuses.sort()).toEqual(['rebuilt:peer', 'rebuilt:self']);
          ctx.expect(buildCount(pkgDir)).toBe(1);
          ctx.expect(fs.existsSync(path.join(pkgDir, local.HEAL_LOCK))).toBe(false); // released
        });
      },
    },

    {
      name: 'a heal lock whose owner is gone is stolen, not waited on',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000);

        const deadPid = spawnSync(process.execPath, ['-e', '']).pid; // a pid that has certainly exited
        const lockDir = path.join(pkgDir, local.HEAL_LOCK);
        fs.mkdirSync(lockDir, { recursive: true });
        fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }));

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuilt');
        ctx.expect(fs.existsSync(lockDir)).toBe(false);
      },
    },

    // ---- watcher liveness

    {
      name: 'a monorepo-linked boot with no live watch lock warns once, naming npm start',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'src'), 1000);
        setTreeTimes(path.join(pkgDir, 'dist'), 2000); // fresh — the warning is about liveness, not staleness

        // Two checks in ONE process: the warning is once per boot, not once per call.
        const cliPath = path.join(consumer, 'cli.js');
        fs.writeFileSync(cliPath, [
          `const local = require(${JSON.stringify(require.resolve('../src/local'))});`,
          `const check = () => local.ensureFreshLocalDist({ packageName: ${JSON.stringify(PKG_NAME)}, fromDir: __dirname });`,
          "console.log('STATUS ' + check().status + ' ' + check().status);",
          '',
        ].join('\n'));

        const env = Object.assign({}, process.env);
        delete env.OMEGA_SKIP_FRESHNESS;
        delete env.OMEGA_FRESH_REEXEC;
        const withoutWatch = spawnSync(process.execPath, [cliPath], { cwd: consumer, env, encoding: 'utf8' });
        ctx.expect(withoutWatch.stdout.includes('STATUS fresh fresh'), withoutWatch.stderr).toBe(true);
        ctx.expect((withoutWatch.stderr.match(/watch is not running/g) || []).length).toBe(1);
        ctx.expect(withoutWatch.stderr).toMatch(/npm start/);

        // Same boot with the watch alive (this test process owns the lock): silent.
        writeWatchLock(root);
        const withWatch = spawnSync(process.execPath, [cliPath], { cwd: consumer, env, encoding: 'utf8' });
        ctx.expect(withWatch.stderr.includes('watch is not running')).toBe(false);
      },
    },

    {
      name: 'a registry install never warns about the watch',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const consumer = path.join(scratch, 'consumer');
        const installed = path.join(consumer, 'node_modules', '@scratch', 'pkg');
        fs.mkdirSync(consumer, { recursive: true });
        fs.writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ name: 'consumer', version: '0.0.0' })}\n`);
        makePkg(installed);

        const cliPath = path.join(consumer, 'cli.js');
        fs.writeFileSync(cliPath, [
          `const local = require(${JSON.stringify(require.resolve('../src/local'))});`,
          `console.log('STATUS ' + local.ensureFreshLocalDist({ packageName: ${JSON.stringify(PKG_NAME)}, fromDir: __dirname }).status);`,
          '',
        ].join('\n'));

        const env = Object.assign({}, process.env);
        delete env.OMEGA_SKIP_FRESHNESS;
        delete env.OMEGA_FRESH_REEXEC;
        const result = spawnSync(process.execPath, [cliPath], { cwd: consumer, env, encoding: 'utf8' });
        ctx.expect(result.stdout.includes('STATUS registry'), result.stderr).toBe(true);
        ctx.expect(result.stderr.includes('watch is not running')).toBe(false);
      },
    },

    {
      name: 'a failing prepare reports rebuild-failed and continues',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        fs.writeFileSync(path.join(pkgDir, 'build.js'), 'process.exit(1);\n');
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
        ctx.expect(result.status).toBe('rebuild-failed');
      },
    },

    // ---- freshnessBoot

    {
      name: 'freshnessBoot runs once per process (module-level once-flag)',
      run: (ctx) => {
        beforeEachHook();
        process.env.OMEGA_SKIP_FRESHNESS = '1'; // safe path — never rebuilds/re-execs in-process
        const first = local.freshnessBoot({ packageName: PKG_NAME, fromDir: makeScratch(ctx) });
        const second = local.freshnessBoot({ packageName: PKG_NAME, fromDir: makeScratch(ctx) });
        ctx.expect(first.status).toBe('skipped');
        ctx.expect(second.status).toBe('already-checked');
      },
    },

    {
      name: 'integration: a wired CLI on a stale link rebuilds and re-execs exactly once',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const pkgDir = path.join(scratch, 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000); // stale

        // A minimal wired CLI: the same freshnessBoot({ packageName }) call each
        // framework run() makes, then the "command" — which prints whether it ran
        // under the re-exec guard.
        const cliPath = path.join(consumer, 'cli.js');
        fs.writeFileSync(cliPath, [
          `const local = require(${JSON.stringify(require.resolve('../src/local'))});`,
          `local.freshnessBoot({ packageName: ${JSON.stringify(PKG_NAME)}, fromDir: __dirname });`,
          "console.log('CLI_RAN reexec=' + (process.env.OMEGA_FRESH_REEXEC || '0'));",
          '',
        ].join('\n'));

        const env = Object.assign({}, process.env);
        delete env.OMEGA_SKIP_FRESHNESS;
        delete env.OMEGA_FRESH_REEXEC;
        const result = spawnSync(process.execPath, [cliPath], { cwd: consumer, env, encoding: 'utf8' });

        ctx.expect(result.status, result.stderr).toBe(0);
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(true); // rebuilt
        ctx.expect((result.stdout.match(/rebuilding/g) || []).length).toBe(1); // one loud rebuild line
        ctx.expect(result.stdout.match(/CLI_RAN reexec=\d/g)).toEqual(['CLI_RAN reexec=1']); // the command ran ONCE, in the re-exec
      },
    },

    {
      name: 'a stale @omega.js/* runtime dep of the host heals too (#198)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const hostDir = path.join(scratch, 'host');
        const depDir = path.join(scratch, 'dep');
        const consumer = path.join(scratch, 'consumer');
        // The web→client shape: the CLI host is fresh, the dep whose dist the host's
        // bundle carries verbatim is not — healing only the host serves stale code.
        makeOmegaPkg(hostDir, HOST_NAME, { [DEP_NAME]: '*' });
        makeOmegaPkg(depDir, DEP_NAME);
        linkPkg(hostDir, DEP_NAME, depDir);
        makeConsumerRoot(consumer);
        linkPkg(consumer, HOST_NAME, hostDir);
        setTreeTimes(path.join(hostDir, 'src'), 1000);
        setTreeTimes(path.join(hostDir, 'dist'), 2000); // host fresh
        setTreeTimes(path.join(depDir, 'dist'), 1000);
        setTreeTimes(path.join(depDir, 'src'), 2000); // dep stale

        const result = runWiredCli(consumer, HOST_NAME);

        ctx.expect(result.status, result.stderr).toBe(0);
        ctx.expect(fs.existsSync(builtSentinel(depDir)), result.stdout).toBe(true); // the DEP got healed
        ctx.expect(buildCount(hostDir)).toBe(0); // the host was fresh — nothing to build
        ctx.expect(result.stdout.match(/CLI_RAN reexec=\d/g)).toEqual(['CLI_RAN reexec=1']); // a dep heal re-execs like any other
      },
    },

    {
      name: 'a fresh dep leaves the boot alone and returns the host result',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const hostDir = path.join(scratch, 'host');
        const depDir = path.join(scratch, 'dep');
        const consumer = path.join(scratch, 'consumer');
        makeOmegaPkg(hostDir, HOST_NAME, { [DEP_NAME]: '*' });
        makeOmegaPkg(depDir, DEP_NAME);
        linkPkg(hostDir, DEP_NAME, depDir);
        makeConsumerRoot(consumer);
        linkPkg(consumer, HOST_NAME, hostDir);
        for (const dir of [hostDir, depDir]) {
          setTreeTimes(path.join(dir, 'src'), 1000);
          setTreeTimes(path.join(dir, 'dist'), 2000);
        }

        const result = runWiredCli(consumer, HOST_NAME);

        ctx.expect(result.status, result.stderr).toBe(0);
        ctx.expect(result.stdout.includes('STATUS fresh'), result.stdout).toBe(true); // the HOST's result
        ctx.expect(result.stdout.match(/CLI_RAN reexec=\d/g)).toEqual(['CLI_RAN reexec=0']); // no re-exec
        ctx.expect(buildCount(hostDir) + buildCount(depDir)).toBe(0);
      },
    },

    {
      name: 'the check list is deps-first, host-last, and a dependency cycle terminates',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const hostDir = path.join(scratch, 'host');
        const depDir = path.join(scratch, 'dep');
        const consumer = path.join(scratch, 'consumer');
        makeOmegaPkg(hostDir, HOST_NAME, { [DEP_NAME]: '*' });
        makeOmegaPkg(depDir, DEP_NAME, { [HOST_NAME]: '*' }); // back-edge: A → B → A
        linkPkg(hostDir, DEP_NAME, depDir);
        linkPkg(depDir, HOST_NAME, hostDir);
        makeConsumerRoot(consumer);
        linkPkg(consumer, HOST_NAME, hostDir);

        const list = local.freshnessCheckList({ packageName: HOST_NAME, fromDir: consumer });
        ctx.expect(list.map((entry) => entry.packageName)).toEqual([DEP_NAME, HOST_NAME]);
        ctx.expect(list[0].fromDir).toBe(hostDir); // each dep resolves from ITS depender
      },
    },

    {
      name: 'a dep that resolves to a registry install is checked but not walked',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const hostDir = path.join(scratch, 'host');
        const granddepDir = path.join(scratch, 'granddep');
        const consumer = path.join(scratch, 'consumer');
        makeOmegaPkg(hostDir, HOST_NAME, { [DEP_NAME]: '*' });
        const installed = path.join(hostDir, 'node_modules', DEP_NAME); // a REAL dir under node_modules
        makeOmegaPkg(installed, DEP_NAME, { [GRANDDEP_NAME]: '*' });
        makeOmegaPkg(granddepDir, GRANDDEP_NAME);
        linkPkg(installed, GRANDDEP_NAME, granddepDir);
        makeConsumerRoot(consumer);
        linkPkg(consumer, HOST_NAME, hostDir);

        const list = local.freshnessCheckList({ packageName: HOST_NAME, fromDir: consumer });
        ctx.expect(list.map((entry) => entry.packageName)).toEqual([DEP_NAME, HOST_NAME]); // no granddep
        ctx.expect(local.ensureFreshLocalDist(list[0]).status).toBe('registry');
      },
    },

    {
      name: 'the walk is transitive through dependencies and never through devDependencies',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const hostDir = path.join(scratch, 'host');
        const depDir = path.join(scratch, 'dep');
        const granddepDir = path.join(scratch, 'granddep');
        const devdepDir = path.join(scratch, 'devdep');
        const consumer = path.join(scratch, 'consumer');
        // host → dep → granddep, and a devDependency that is just as linkable: the
        // depth stops at nothing a consumer RUNS, and starts at nothing it doesn't.
        makeOmegaPkg(hostDir, HOST_NAME, { [DEP_NAME]: '*' });
        makeOmegaPkg(depDir, DEP_NAME, { [GRANDDEP_NAME]: '*' }, { [DEVDEP_NAME]: '*' });
        makeOmegaPkg(granddepDir, GRANDDEP_NAME);
        makeOmegaPkg(devdepDir, DEVDEP_NAME);
        linkPkg(hostDir, DEP_NAME, depDir);
        linkPkg(depDir, GRANDDEP_NAME, granddepDir);
        linkPkg(depDir, DEVDEP_NAME, devdepDir); // resolvable, and still not walked
        makeConsumerRoot(consumer);
        linkPkg(consumer, HOST_NAME, hostDir);

        const list = local.freshnessCheckList({ packageName: HOST_NAME, fromDir: consumer });
        ctx.expect(list.map((entry) => entry.packageName)).toEqual([GRANDDEP_NAME, DEP_NAME, HOST_NAME]);
        ctx.expect(list[0].fromDir).toBe(depDir); // the granddep resolved from ITS depender
      },
    },

    // ---- linked into the monorepo is READ-ONLY to consumer builds WHILE THE WATCH
    // RUNS (#281) — and heals itself when it does not (#398)

    {
      name: 'a stale monorepo-linked package under a live watch is reported, never rebuilt in place (#281)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000); // a src edit the watch has not landed yet
        writeWatchLock(root); // and the watch that owns landing it is alive
        const distMtime = fs.statSync(path.join(pkgDir, 'dist', 'index.js')).mtimeMs;

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });

        ctx.expect(result.status).toBe('stale-linked');
        ctx.expect(result.reason).toBe('dist/index.js is older than src/index.js');
        ctx.expect(result.monorepoRoot).toBe(root);
        // The whole point: no prepare ran, so no dist purge and no cache refetch, and
        // the package dir is byte-for-byte what the watch left there.
        ctx.expect(buildCount(pkgDir)).toBe(0);
        ctx.expect(fs.statSync(path.join(pkgDir, 'dist', 'index.js')).mtimeMs).toBe(distMtime);
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(false);
        ctx.expect(fs.existsSync(path.join(pkgDir, '.omega'))).toBe(false); // not even a lock is written
      },
    },

    {
      name: 'a stale monorepo link with the watch DOWN heals in place under the heal lock (#398)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000); // stale, and no watch lock: nothing else owns the rebuild

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });

        ctx.expect(result.status).toBe('rebuilt');
        ctx.expect(result.by).toBe('self');
        ctx.expect(buildCount(pkgDir)).toBe(1);
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(true);
        ctx.expect(fs.existsSync(path.join(pkgDir, local.HEAL_LOCK))).toBe(false); // taken like any heal, and released
      },
    },

    {
      name: 'the watch-down heal re-execs the invocation and still warns about the dead watch (#398)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir, { withDist: false }); // the brand-boot shape: a linked dist nobody ever built
        makeConsumer(consumer, pkgDir);

        const run = runWiredCli(consumer, PKG_NAME);

        ctx.expect(run.status, run.stderr).toBe(0); // no loud stop — the boot fixed it
        ctx.expect(fs.existsSync(builtSentinel(pkgDir))).toBe(true);
        ctx.expect(run.stdout.match(/CLI_RAN reexec=\d/g)).toEqual(['CLI_RAN reexec=1']); // the verb ran ONCE, past the heal
        // The heal freshens this boot; a src edit made during the session still needs
        // the watch, so the once-per-process warning stays on this path.
        ctx.expect((run.stderr.match(/watch is not running/g) || []).length, run.stderr).toBe(1);
        ctx.expect(run.stderr).toMatch(/npm start/);
        ctx.expect(run.stderr.includes('read-only to consumer builds')).toBe(false);
      },
    },

    {
      name: 'a watch-down heal whose prepare FAILS is heal-failed, not a continue-on-stale (#398)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir);
        fs.writeFileSync(path.join(pkgDir, 'build.js'), 'process.exit(3);\n'); // the prepare a broken src gives you
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000);

        const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });

        // The heal was this dist's ONLY chance — nothing else rebuilds it, so the
        // outcome is a stop for the boot, never a plain checkout's warn-and-continue
        ctx.expect(result.status).toBe('heal-failed');
        ctx.expect(result.reason).toBe('dist/index.js is older than src/index.js');
        ctx.expect(result.monorepoRoot).toBe(root);
        ctx.expect(result.failure).toMatch(/npm run prepare exited 3/);
        ctx.expect(fs.existsSync(path.join(pkgDir, local.HEAL_LOCK))).toBe(false); // released, failure and all
      },
    },

    {
      name: 'a failed watch-down heal stops the boot, naming the prepare to run by hand (#398)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir, { withDist: false });
        fs.writeFileSync(path.join(pkgDir, 'build.js'), 'process.exit(3);\n');
        makeConsumer(consumer, pkgDir);

        const run = runWiredCli(consumer, PKG_NAME);

        ctx.expect(run.status, run.stdout).not.toBe(0); // before #398 this booted on the stale dist
        ctx.expect(run.stderr).toMatch(new RegExp(PKG_NAME.replace('/', '\\/')));
        ctx.expect(run.stderr).toMatch(/npm run prepare/); // what to run
        ctx.expect(run.stderr.includes(pkgDir), run.stderr).toBe(true); // and where
        ctx.expect(run.stdout.includes('CLI_RAN')).toBe(false); // the command never ran
      },
    },

    {
      name: 'the sweep unions the lanes\' check lists and heals a shared dep ONCE (#340)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const { depDir, hosts } = makeFanOut(scratch);
        for (const dir of [path.join(scratch, 'host-a'), path.join(scratch, 'host-b')]) {
          setTreeTimes(path.join(dir, 'src'), 1000);
          setTreeTimes(path.join(dir, 'dist'), 2000); // both lane hosts fresh
        }
        setTreeTimes(path.join(depDir, 'dist'), 1000);
        setTreeTimes(path.join(depDir, 'src'), 2000); // the shared dep is not

        const sweep = local.freshnessSweep({ hosts });

        // The dep is in BOTH lanes' closures and is checked once — two lanes checking
        // it themselves is what let two prepares overlap
        ctx.expect(sweep.checked.map((entry) => entry.packageName)).toEqual([DEP_NAME, HOST_NAME, HOST_B_NAME]);
        ctx.expect(sweep.healed).toEqual([DEP_NAME]);
        ctx.expect(sweep.staleLinked).toEqual([]);
        ctx.expect(buildCount(depDir)).toBe(1);
        ctx.expect(fs.existsSync(builtSentinel(depDir))).toBe(true); // and the dist a lane spawned now would load is complete
      },
    },

    {
      name: 'the sweep still checks under the boot re-exec guard — a re-execed dev hands the lanes nothing (#340)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const { depDir, hosts } = makeFanOut(scratch);
        setTreeTimes(path.join(depDir, 'dist'), 1000);
        setTreeTimes(path.join(depDir, 'src'), 2000);
        // The guard is freshnessBoot's LOOP guard: `omega dev` that healed its own
        // host re-execs with it set, and that process is the one that spawns lanes.
        process.env.OMEGA_FRESH_REEXEC = '1';

        const sweep = local.freshnessSweep({ hosts });

        ctx.expect(sweep.healed).toEqual([DEP_NAME]);
        ctx.expect(buildCount(depDir)).toBe(1);
        ctx.expect(process.env.OMEGA_FRESH_REEXEC, 'and the guard is put back for whatever runs next').toBe('1');
      },
    },

    {
      name: 'the sweep honours OMEGA_SKIP_FRESHNESS — the test/CI hatch is not a fan-out loophole (#340)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const { depDir, hosts } = makeFanOut(scratch);
        setTreeTimes(path.join(depDir, 'dist'), 1000);
        setTreeTimes(path.join(depDir, 'src'), 2000);
        process.env.OMEGA_SKIP_FRESHNESS = '1';

        const sweep = local.freshnessSweep({ hosts });

        ctx.expect(sweep.healed).toEqual([]);
        ctx.expect(buildCount(depDir)).toBe(0);
      },
    },

    {
      name: 'a monorepo-linked stale dist under a live watch comes back from the sweep as the loud stop, nothing built (#340)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir);
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000);
        writeWatchLock(root);

        let sweep;
        const stderr = captureError(() => {
          sweep = local.freshnessSweep({ hosts: [{ packageName: PKG_NAME, fromDir: consumer }] });
        });

        ctx.expect(sweep.staleLinked.length).toBe(1);
        ctx.expect(sweep.staleLinked[0].packageName).toBe(PKG_NAME);
        ctx.expect(stderr).toMatch(/read-only to consumer builds/); // the caller stops the boot; the sweep says why
        ctx.expect(buildCount(pkgDir)).toBe(0);
      },
    },

    {
      name: 'a monorepo-linked heal that FAILS comes back from the sweep as a loud stop too (#398)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir);
        fs.writeFileSync(path.join(pkgDir, 'build.js'), 'process.exit(3);\n');
        makeConsumer(consumer, pkgDir);
        setTreeTimes(path.join(pkgDir, 'dist'), 1000);
        setTreeTimes(path.join(pkgDir, 'src'), 2000); // no watch lock: this boot's heal is the only one coming

        let sweep;
        const stderr = captureError(() => {
          sweep = local.freshnessSweep({ hosts: [{ packageName: PKG_NAME, fromDir: consumer }] });
        });

        ctx.expect(sweep.healFailed.length).toBe(1);
        ctx.expect(sweep.healFailed[0].packageName).toBe(PKG_NAME);
        ctx.expect(sweep.failed).toEqual([]); // a monorepo failure is never the continue-on-stale bucket
        ctx.expect(stderr).toMatch(/npm run prepare/); // the lanes never spawn; the sweep says what to fix
      },
    },

    {
      name: 'RED baseline: an unswept fan-out kills the sibling lane — its dispatcher requires a purged dist (#340)',
      run: async (ctx) => {
        beforeEachHook();
        const { pkgDir, consumer, binPath } = stageLanes(ctx);

        // The incident: lane one heals the stale dist (prepare PURGES dist before
        // recopying) while lane two dispatches through the same package.
        const laneOne = runLane(binPath, consumer);
        await awaitPurged(pkgDir);
        const laneTwo = await runLane(binPath, consumer);

        ctx.expect(laneTwo.status, laneTwo.stdout).not.toBe(0);
        ctx.expect(laneTwo.stderr).toMatch(/Cannot find module/);
        ctx.expect(laneTwo.stdout.includes('LANE_OK'), 'the lane died before its CLI ever ran').toBe(false);
        ctx.expect((await laneOne).status, 'while the rebuilding lane finished fine').toBe(0);
      },
    },

    {
      name: 'swept first, both lanes boot on a complete dist and neither rebuilds (#340)',
      run: async (ctx) => {
        beforeEachHook();
        const { pkgDir, consumer, binPath } = stageLanes(ctx);

        const sweep = local.freshnessSweep({ hosts: [{ packageName: PKG_NAME, fromDir: consumer }] });
        const [laneOne, laneTwo] = await Promise.all([runLane(binPath, consumer), runLane(binPath, consumer)]);

        ctx.expect(sweep.healed).toEqual([PKG_NAME]);
        ctx.expect(laneOne.status, laneOne.stderr).toBe(0);
        ctx.expect(laneTwo.status, laneTwo.stderr).toBe(0);
        ctx.expect(laneOne.stdout.includes('LANE_OK') && laneTwo.stdout.includes('LANE_OK')).toBe(true);
        ctx.expect(buildCount(pkgDir), 'the ONE rebuild happened before the fan-out — no lane ran a second prepare').toBe(1);
      },
    },

    {
      name: 'a monorepo-linked dep with no dist fails the build loudly under a live watch, naming it (#281)',
      run: (ctx) => {
        beforeEachHook();
        const scratch = makeScratch(ctx);
        const root = path.join(scratch, 'monorepo');
        const pkgDir = path.join(root, 'packages', 'pkg');
        const consumer = path.join(scratch, 'consumer');
        makeFakeMonorepo(root);
        makePkg(pkgDir, { withDist: false }); // never built here, and never built by us
        makeConsumer(consumer, pkgDir);
        writeWatchLock(root); // the watch that owns the build is alive — this boot waits for it

        const run = runWiredCli(consumer, PKG_NAME);

        ctx.expect(run.status, run.stdout).toBe(1);
        ctx.expect(run.stderr).toMatch(/read-only to consumer builds/);
        ctx.expect(run.stderr).toMatch(/dist\/ is missing/);
        ctx.expect(run.stderr).toMatch(/is running but has not landed that build yet/); // wait for that watch, do not build over it
        ctx.expect(run.stderr).toMatch(/npm start/);
        ctx.expect(run.stderr.includes(root), run.stderr).toBe(true); // named, so you know which watch
        ctx.expect(buildCount(pkgDir)).toBe(0);
        ctx.expect(fs.existsSync(path.join(pkgDir, 'dist'))).toBe(false);
        ctx.expect(run.stdout.includes('CLI_RAN')).toBe(false); // the command never ran
      },
    },
  ],
});
