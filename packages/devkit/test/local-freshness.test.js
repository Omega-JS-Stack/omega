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
const { spawnSync } = require('node:child_process');
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
 * a REAL prepare script (node build.js — copies src→dist + writes a
 * dist/built.txt sentinel) unless withPrepare=false.
 */
function makePkg(dir, options = {}) {
  const { withPrepare = true, withDist = true } = options;

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: PKG_NAME,
    version: '0.0.0',
    scripts: withPrepare ? { prepare: 'node build.js' } : {},
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'build.js'), [
    "const fs = require('fs');",
    "const path = require('path');",
    "const dist = path.join(__dirname, 'dist');",
    'fs.rmSync(dist, { recursive: true, force: true });',
    "fs.cpSync(path.join(__dirname, 'src'), dist, { recursive: true });",
    "fs.writeFileSync(path.join(dist, 'built.txt'), String(Date.now()));",
    '',
  ].join('\n'));
  if (withDist) {
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'module.exports = 1;\n');
  }
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
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'built.txt')), false);
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
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'built.txt')), true);
});

test('a missing dist is stale and rebuilds', (t) => {
  const scratch = makeScratch(t);
  const pkgDir = path.join(scratch, 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makePkg(pkgDir, { withDist: false });
  makeConsumer(consumer, pkgDir);

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'rebuilt');
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'built.txt')), true);
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
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'built.txt')), true);
});

test('a live monorepo watch lock defers the rebuild (watch-owned)', (t) => {
  const scratch = makeScratch(t);
  const root = path.join(scratch, 'monorepo');
  const pkgDir = path.join(root, 'packages', 'pkg');
  const consumer = path.join(scratch, 'consumer');
  makeFakeMonorepo(root);
  makePkg(pkgDir);
  makeConsumer(consumer, pkgDir);
  setTreeTimes(path.join(pkgDir, 'dist'), 1000);
  setTreeTimes(path.join(pkgDir, 'src'), 2000); // stale
  fs.mkdirSync(path.join(root, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(root, '.omega', 'dev-watch.lock'), JSON.stringify({ pid: process.pid }));

  const result = local.ensureFreshLocalDist({ packageName: PKG_NAME, fromDir: consumer });
  assert.equal(result.status, 'watch-owned');
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'built.txt')), false);
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
  assert.equal(fs.existsSync(path.join(pkgDir, 'dist', 'built.txt')), true); // rebuilt
  assert.equal((result.stdout.match(/rebuilding/g) || []).length, 1); // one loud rebuild line
  assert.deepEqual(result.stdout.match(/CLI_RAN reexec=\d/g), ['CLI_RAN reexec=1']); // the command ran ONCE, in the re-exec
});
