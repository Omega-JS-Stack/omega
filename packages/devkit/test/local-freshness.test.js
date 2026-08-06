// Unit tests for src/local.js ensureFreshLocalDist/freshnessBoot — the
// local-dist freshness guard (auto-rebuild stale dists at CLI boot).
//
// Real-execution only (no mocks): every scenario runs against a scratch
// package on disk, and the rebuild path spawns the fixture's REAL
// `npm run prepare` (offline — the prepare script is a local node build).
// Staleness is driven with explicit utimes, never sleeps.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const local = require('../src/local');

const PKG_NAME = '@scratch/pkg';

// The guard's env seams leak across tests (and CI may set the skip hatch for
// OTHER harnesses) — every test here starts with both cleared.
beforeEach(() => {
  delete process.env.OMEGA_SKIP_FRESHNESS;
  delete process.env.OMEGA_FRESH_REEXEC;
});

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
 */
function makePkg(dir, options = {}) {
  const { withPrepare = true, withDist = true, manifest = {}, buildMs = 0 } = options;

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

/** Fake monorepo root recognized by isMonorepoRoot, with a devkit src to age. */
function makeFakeMonorepo(root) {
  fs.mkdirSync(path.join(root, 'packages', 'devkit', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'omega', version: '0.0.0' })}\n`);
  fs.writeFileSync(path.join(root, 'packages', 'devkit', 'package.json'), `${JSON.stringify({ name: '@omega.js/devkit', version: '0.0.0' })}\n`);
  fs.writeFileSync(path.join(root, 'packages', 'devkit', 'src', 'index.js'), 'module.exports = 1;\n');
}

// ---- vendorable-list parity pin

test('FRESHNESS_VENDORABLES matches tools/vendor.js VENDORABLE_PACKAGES (the SSOT)', () => {
  assert.deepEqual(local.FRESHNESS_VENDORABLES, require('../tools/vendor').VENDORABLE_PACKAGES);
});

// ---- env seams

test('OMEGA_SKIP_FRESHNESS short-circuits to skipped', (t) => {
  process.env.OMEGA_SKIP_FRESHNESS = '1';
  assert.equal(local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: makeScratch(t) }).status, 'skipped');
});

test('OMEGA_FRESH_REEXEC short-circuits to reexec-guard', (t) => {
  process.env.OMEGA_FRESH_REEXEC = '1';
  assert.equal(local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: makeScratch(t) }).status, 'reexec-guard');
});

// ---- resolution shapes

test('a real registry install (realpath inside node_modules) is skipped', (t) => {
  const scratch = makeScratch(t);
  const consumer = path.join(scratch, 'consumer');
  const installed = path.join(consumer, 'node_modules', '@scratch', 'pkg');
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ name: 'consumer', version: '0.0.0' })}\n`);
  makePkg(installed); // a REAL directory under node_modules, src+prepare and all

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'registry');
});

test('an unresolvable package (bootstrap dir) is skipped as registry', (t) => {
  assert.equal(local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: makeScratch(t) }).status, 'registry');
});

test('a linked package without src or prepare is not-buildable', (t) => {
  const scratch = makeScratch(t);
  const pkgDir = path.join(scratch, 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makePkg(pkgDir, { withPrepare: false });
  makeConsumer(consumer, pkgDir);

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'not-buildable');
  assert.equal(result.dir, pkgDir);
});

// ---- staleness

test('dist newer than src is fresh — no rebuild', (t) => {
  const scratch = makeScratch(t);
  const pkgDir = path.join(scratch, 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makePkg(pkgDir);
  makeConsumer(consumer, pkgDir);
  setTreeTimes(path.join(pkgDir, 'src'), 1000);
  setTreeTimes(path.join(pkgDir, 'dist'), 2000);

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'fresh');
  assert.equal(fs.existsSync(builtSentinel(pkgDir)), false);
});

test('src newer than dist triggers a real prepare and reports rebuilt', (t) => {
  const scratch = makeScratch(t);
  const pkgDir = path.join(scratch, 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makePkg(pkgDir);
  makeConsumer(consumer, pkgDir);
  setTreeTimes(path.join(pkgDir, 'dist'), 1000);
  setTreeTimes(path.join(pkgDir, 'src'), 2000);

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(builtSentinel(pkgDir)), true);
});

test('a missing dist is stale and rebuilds', (t) => {
  const scratch = makeScratch(t);
  const pkgDir = path.join(scratch, 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makePkg(pkgDir, { withDist: false });
  makeConsumer(consumer, pkgDir);

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(builtSentinel(pkgDir)), true);
});

test('a stale vendored copy (monorepo package) triggers a rebuild even with a fresh own-src dist', (t) => {
  const scratch = makeScratch(t);
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

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(builtSentinel(pkgDir)), true);
});

// ---- per-file evidence (#195: the whole-tree mtime compare could be fooled)

test('a newer vendor write inside dist no longer masks a src file dist never got', (t) => {
  const scratch = makeScratch(t);
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
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'new.js')), true);
});

test('a src file missing its dist counterpart is stale regardless of mtimes', (t) => {
  const scratch = makeScratch(t);
  const pkgDir = path.join(scratch, 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makePkg(pkgDir);
  makeConsumer(consumer, pkgDir);
  fs.mkdirSync(path.join(pkgDir, 'src', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'src', 'commands', 'setup.js'), 'module.exports = 3;\n');
  setTreeTimes(path.join(pkgDir, 'src'), 1000);
  setTreeTimes(path.join(pkgDir, 'dist'), 5000); // every existing dist file is newer

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'commands', 'setup.js')), true);
});

test('a dist leftover from a deleted src file is stale', (t) => {
  const scratch = makeScratch(t);
  const pkgDir = path.join(scratch, 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makePkg(pkgDir);
  makeConsumer(consumer, pkgDir);
  fs.writeFileSync(path.join(pkgDir, 'dist', 'removed.js'), 'module.exports = 4;\n'); // src copy deleted
  setTreeTimes(path.join(pkgDir, 'src'), 1000);
  setTreeTimes(path.join(pkgDir, 'dist'), 2000);

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'removed.js')), false);
});

test('the extras prepare generates (vendor, declared assets) stay fresh', (t) => {
  const scratch = makeScratch(t);
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
  assert.equal(result.status, 'fresh');
  assert.equal(fs.existsSync(builtSentinel(pkgDir)), false);
});

test('a dist/docs or dist/package.json leftover is stale — nothing generates them in dist', (t) => {
  const scratch = makeScratch(t);
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
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'package.json')), false);
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'docs')), false);
});

// ---- the live watch: bounded grace, then heal anyway

test('stale under a live watch lock heals here once the bounded recheck expires', (t) => {
  const scratch = makeScratch(t);
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
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(builtSentinel(pkgDir)), true);
});

test('a watcher copy landing inside the grace window is a heal by the watch (rebuilt/watch)', (t) => {
  const scratch = makeScratch(t);
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
  t.after(() => watcher.kill());

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'rebuilt'); // a heal is a heal — the caller re-execs
  assert.equal(result.by, 'watch');
  assert.equal(buildCount(pkgDir), 0); // the watch built it, not us
  assert.equal(fs.existsSync(builtSentinel(pkgDir)), false);
});

// ---- the per-package heal lock

test('two CLIs healing the same stale package produce exactly one build', (t) => {
  const scratch = makeScratch(t);
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
    assert.deepEqual(statuses.sort(), ['rebuilt:peer', 'rebuilt:self']);
    assert.equal(buildCount(pkgDir), 1);
    assert.equal(fs.existsSync(path.join(pkgDir, local.HEAL_LOCK)), false); // released
  });
});

test('a heal lock whose owner is gone is stolen, not waited on', (t) => {
  const scratch = makeScratch(t);
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
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(lockDir), false);
});

// ---- watcher liveness

test('a monorepo-linked boot with no live watch lock warns once, naming npm start', (t) => {
  const scratch = makeScratch(t);
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
  assert.equal(withoutWatch.stdout.includes('STATUS fresh fresh'), true, withoutWatch.stderr);
  assert.equal((withoutWatch.stderr.match(/watch is not running/g) || []).length, 1);
  assert.match(withoutWatch.stderr, /npm start/);

  // Same boot with the watch alive (this test process owns the lock): silent.
  writeWatchLock(root);
  const withWatch = spawnSync(process.execPath, [cliPath], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(withWatch.stderr.includes('watch is not running'), false);
});

test('a registry install never warns about the watch', (t) => {
  const scratch = makeScratch(t);
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
  assert.equal(result.stdout.includes('STATUS registry'), true, result.stderr);
  assert.equal(result.stderr.includes('watch is not running'), false);
});

test('a failing prepare reports rebuild-failed and continues', (t) => {
  const scratch = makeScratch(t);
  const pkgDir = path.join(scratch, 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makePkg(pkgDir);
  fs.writeFileSync(path.join(pkgDir, 'build.js'), 'process.exit(1);\n');
  makeConsumer(consumer, pkgDir);
  setTreeTimes(path.join(pkgDir, 'dist'), 1000);
  setTreeTimes(path.join(pkgDir, 'src'), 2000);

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'rebuild-failed');
});

// ---- freshnessBoot

test('freshnessBoot runs once per process (module-level once-flag)', (t) => {
  process.env.OMEGA_SKIP_FRESHNESS = '1'; // safe path — never rebuilds/re-execs in-process
  const first = local.freshnessBoot({ packageName: PKG_NAME, fromDir: makeScratch(t) });
  const second = local.freshnessBoot({ packageName: PKG_NAME, fromDir: makeScratch(t) });
  assert.equal(first.status, 'skipped');
  assert.equal(second.status, 'already-checked');
});

test('integration: a wired CLI on a stale link rebuilds and re-execs exactly once', (t) => {
  const scratch = makeScratch(t);
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

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(builtSentinel(pkgDir)), true); // rebuilt
  assert.equal((result.stdout.match(/rebuilding/g) || []).length, 1); // one loud rebuild line
  assert.deepEqual(result.stdout.match(/CLI_RAN reexec=\d/g), ['CLI_RAN reexec=1']); // the command ran ONCE, in the re-exec
});
