/**
 * Local-development linking for the OMEGA monorepo (master plan §8).
 *
 * The single home for every "work against the local framework source" mechanic:
 * - resolveMonorepoRoot()  — find the Omega monorepo on this machine
 * - findBrandRoot()        — walk up from a cwd to the brand repo root
 * - discoverApps()         — list the brand's app directories
 * - frameworkPackagesOf()  — which @omegajs packages an app depends on
 * - linkLocalPackages()    — file:-install those from the monorepo (idempotent)
 * - startMonorepoWatch()   — spawn the monorepo's src→dist watch (`npm start`)
 * - acquireWatchLock() / releaseWatchLock() — single-instance guard for the watch
 *
 * Consumers: `omega dev --local` (@omegajs/web), `mgr i local`
 * (@omegajs/backend, @omegajs/desktop, @omegajs/extension), and the monorepo's
 * own scripts/watch-all.js (lock helpers).
 */

// Libraries
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { safeInstall } = require('./safe-install');

// Constants
const SCOPE = '@omegajs/';
const DEFAULT_MONOREPO = path.join(os.homedir(), 'Developer', 'Repositories', 'Omega', 'omega');
const WATCH_LOCK = path.join('.omega', 'dev-watch.lock');

/**
 * Check whether a directory is the Omega monorepo root (package.json named
 * "omega" and a packages/devkit workspace).
 * @param {string} dir - Directory to test.
 * @returns {boolean}
 */
function isMonorepoRoot(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg.name === 'omega' && fs.existsSync(path.join(dir, 'packages', 'devkit', 'package.json'));
  } catch (e) {
    return false;
  }
}

/**
 * Resolve the Omega monorepo root on this machine.
 *
 * Order: OMEGA_MONOREPO env override → self-location (walk up from this file's
 * REAL path — covers the workspace copy at <root>/packages/devkit/src, copies
 * vendored into a linked framework's dist/vendor/devkit, and consumers living
 * inside the monorepo; a registry install outside it finds no root and falls
 * through) → the conventional clone location.
 * @returns {string} Absolute monorepo root path.
 * @throws {Error} When no candidate is a valid monorepo root.
 */
function resolveMonorepoRoot() {
  const fromEnv = process.env.OMEGA_MONOREPO;
  if (fromEnv) {
    if (!isMonorepoRoot(fromEnv)) {
      throw new Error(`OMEGA_MONOREPO is set but is not the Omega monorepo root: ${fromEnv}`);
    }
    return path.resolve(fromEnv);
  }

  let dir = fs.realpathSync(__dirname);
  while (true) {
    if (isMonorepoRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  if (isMonorepoRoot(DEFAULT_MONOREPO)) {
    return DEFAULT_MONOREPO;
  }

  throw new Error(
    `Could not find the Omega monorepo (looked for ${DEFAULT_MONOREPO}). `
    + `Clone it there or set OMEGA_MONOREPO to its root.`
  );
}

/**
 * Map an @omegajs package name to its monorepo package directory.
 * @param {string} monorepoRoot - Monorepo root path.
 * @param {string} name - Package name (e.g. '@omegajs/client').
 * @returns {string} Absolute path to packages/<short-name>.
 */
function packageDir(monorepoRoot, name) {
  return path.join(monorepoRoot, 'packages', name.slice(SCOPE.length));
}

/**
 * Check whether a directory contains at least one apps/<name>/package.json.
 * @param {string} dir - Directory to test.
 * @returns {boolean}
 */
function hasApps(dir) {
  const appsDir = path.join(dir, 'apps');
  try {
    return fs.readdirSync(appsDir).some((entry) => fs.existsSync(path.join(appsDir, entry, 'package.json')));
  } catch (e) {
    return false;
  }
}

/**
 * Walk up from a starting directory to the brand repo root: the first
 * directory with BOTH a package.json and an apps/<name>/package.json (a brand
 * monorepo). The Omega monorepo itself is never a brand root — a standalone
 * app living inside it (spike, fixture) resolves to itself. Falls back to the
 * nearest package.json (a standalone app), then to the starting directory.
 * @param {string} startDir - Directory to walk up from (usually process.cwd()).
 * @returns {string} Absolute brand root path.
 */
function findBrandRoot(startDir) {
  let dir = path.resolve(startDir);
  let nearestPackage = null;

  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      nearestPackage = nearestPackage || dir;
      if (hasApps(dir) && !isMonorepoRoot(dir)) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return nearestPackage || path.resolve(startDir);
}

/**
 * List a brand's app directories: the brand root itself plus every
 * apps/<name> that has a package.json.
 * @param {string} brandRoot - Brand root path.
 * @returns {string[]} Absolute app directory paths.
 */
function discoverApps(brandRoot) {
  const apps = [brandRoot];
  const appsDir = path.join(brandRoot, 'apps');

  try {
    for (const entry of fs.readdirSync(appsDir).sort()) {
      const appDir = path.join(appsDir, entry);
      if (fs.existsSync(path.join(appDir, 'package.json'))) {
        apps.push(appDir);
      }
    }
  } catch (e) {
    // No apps/ directory — standalone brand, the root is the only app
  }

  return apps;
}

/**
 * Collect an app's @omegajs dependencies from its package.json — and, for
 * backend apps, from functions/package.json (where the framework dep lives).
 * @param {string} appDir - App directory.
 * @returns {Array<{name: string, spec: string, dev: boolean, dir: string}>}
 */
function frameworkPackagesOf(appDir) {
  const entries = [];

  const collect = (dir) => {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch (e) {
      return;
    }
    for (const [depKey, dev] of [['dependencies', false], ['devDependencies', true]]) {
      for (const [name, spec] of Object.entries(pkg[depKey] || {})) {
        if (name.startsWith(SCOPE)) {
          entries.push({ name, spec, dev, dir });
        }
      }
    }
  };

  collect(appDir);
  if (fs.existsSync(path.join(appDir, 'functions', 'package.json'))) {
    collect(path.join(appDir, 'functions'));
  }

  return entries;
}

/**
 * Check whether a dependency is already the monorepo copy: the FIRST
 * node_modules entry walking up from dir (mirroring Node resolution — npm
 * workspaces hoist installs to the brand root) resolves to the target package
 * directory.
 * @param {string} dir - Directory the dependency is declared in.
 * @param {string} name - Package name.
 * @param {string} targetDir - Monorepo package directory.
 * @returns {boolean}
 */
function isLinkedTo(dir, name, targetDir) {
  let current = path.resolve(dir);

  while (true) {
    const candidate = path.join(current, 'node_modules', name);
    if (fs.existsSync(candidate)) {
      try {
        return fs.realpathSync(candidate) === fs.realpathSync(targetDir);
      } catch (e) {
        return false;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
}

/**
 * file:-install an app's @omegajs dependencies from the local monorepo.
 * Idempotent: dependencies already resolving to the monorepo copy are skipped.
 * @param {object} options
 * @param {string} options.dir - App directory to link.
 * @param {string} options.monorepoRoot - Monorepo root path.
 * @param {object} [options.logger] - Logger with log/warn (silent when omitted).
 * @param {boolean} [options.dryRun] - Plan only, run no installs.
 * @returns {Promise<Array<{name: string, dir: string, target: string, action: 'link'|'skip'|'missing'}>>}
 */
async function linkLocalPackages(options) {
  const { dir, monorepoRoot, logger, dryRun } = options;
  const actions = [];

  for (const entry of frameworkPackagesOf(dir)) {
    const target = packageDir(monorepoRoot, entry.name);

    if (!fs.existsSync(path.join(target, 'package.json'))) {
      actions.push({ name: entry.name, dir: entry.dir, target, action: 'missing' });
      logger && logger.warn(`${entry.name}: no monorepo package at ${target} — skipping`);
      continue;
    }

    if (isLinkedTo(entry.dir, entry.name, target)) {
      actions.push({ name: entry.name, dir: entry.dir, target, action: 'skip' });
      logger && logger.log(`${entry.name}: already linked to the monorepo`);
      continue;
    }

    actions.push({ name: entry.name, dir: entry.dir, target, action: 'link' });
    logger && logger.log(`${entry.name}: linking → ${target}`);
    if (!dryRun) {
      await safeInstall(`npm install ${target}${entry.dev ? ' --save-dev' : ''}`, { log: true, config: { cwd: entry.dir } });
    }
  }

  return actions;
}

/**
 * Read the watch lock and return the live owner pid — clearing the lock when
 * its process is gone.
 * @param {string} monorepoRoot - Monorepo root path.
 * @returns {number|null} Live pid, or null when unlocked.
 */
function readLiveWatchPid(monorepoRoot) {
  const lockPath = path.join(monorepoRoot, WATCH_LOCK);
  let pid;

  try {
    pid = JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid;
  } catch (e) {
    return null;
  }

  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    // Stale lock — the owning process is gone
    fs.rmSync(lockPath, { force: true });
    return null;
  }
}

/**
 * Take the single-instance watch lock for this process.
 * @param {string} monorepoRoot - Monorepo root path.
 * @returns {{acquired: boolean, pid: number}} pid is the lock owner (ours on success).
 */
function acquireWatchLock(monorepoRoot) {
  const livePid = readLiveWatchPid(monorepoRoot);
  if (livePid) {
    return { acquired: false, pid: livePid };
  }

  const lockPath = path.join(monorepoRoot, WATCH_LOCK);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
  return { acquired: true, pid: process.pid };
}

/**
 * Release the watch lock — only when this process owns it.
 * @param {string} monorepoRoot - Monorepo root path.
 */
function releaseWatchLock(monorepoRoot) {
  const lockPath = path.join(monorepoRoot, WATCH_LOCK);
  try {
    if (JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid === process.pid) {
      fs.rmSync(lockPath, { force: true });
    }
  } catch (e) {
    // No lock (or unreadable) — nothing to release
  }
}

/**
 * Spawn the monorepo's src→dist watch (`npm start` at the monorepo root) as a
 * child process, unless one is already running (lock held by a live process —
 * the watch script itself takes the lock).
 * @param {object} options
 * @param {string} options.monorepoRoot - Monorepo root path.
 * @param {object} [options.logger] - Logger with log (silent when omitted).
 * @returns {{alreadyRunning: boolean, pid: number|null, child: object|null}}
 */
function startMonorepoWatch(options) {
  const { monorepoRoot, logger } = options;

  const livePid = readLiveWatchPid(monorepoRoot);
  if (livePid) {
    logger && logger.log(`Monorepo watch already running (pid ${livePid}) — leaving it be`);
    return { alreadyRunning: true, pid: livePid, child: null };
  }

  const child = spawn('npm', ['start'], { cwd: monorepoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const forward = (stream) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) {
          logger ? logger.log(`[watch] ${line}`) : console.log(`[watch] ${line}`);
        }
      }
    });
  };
  forward(child.stdout);
  forward(child.stderr);
  logger && logger.log(`Monorepo watch started (pid ${child.pid}) — src→dist rebuilds are live`);

  return { alreadyRunning: false, pid: child.pid, child };
}

// Exports
module.exports = {
  DEFAULT_MONOREPO,
  WATCH_LOCK,
  isMonorepoRoot,
  resolveMonorepoRoot,
  packageDir,
  findBrandRoot,
  discoverApps,
  frameworkPackagesOf,
  linkLocalPackages,
  startMonorepoWatch,
  readLiveWatchPid,
  acquireWatchLock,
  releaseWatchLock,
};
