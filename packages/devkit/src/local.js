/**
 * Local-development linking for the OMEGA monorepo (master plan §8).
 *
 * The single home for every "work against the local framework source" mechanic:
 * - resolveMonorepoRoot()  — find the Omega monorepo on this machine
 * - findBrandRoot()        — walk up from a cwd to the brand repo root
 * - discoverApps()         — list the brand's app directories
 * - frameworkPackagesOf()  — which @omega.js packages an app depends on
 * - linkLocalPackages()    — file:-install those from the monorepo (idempotent)
 * - startMonorepoWatch()   — spawn the monorepo's src→dist watch (`npm start`)
 * - acquireWatchLock() / releaseWatchLock() — single-instance guard for the watch
 * - startVendorPropagation() — re-prepare dist-building frameworks when a
 *   vendored shared package (devkit, config, account) changes
 * - ensureFreshLocalDist() / freshnessBoot() — rebuild a locally-linked
 *   framework's stale dist at CLI boot (and re-exec once after a rebuild)
 *
 * Consumers: `omega dev --local` (@omega.js/web), `mgr i local`
 * (@omega.js/backend, @omega.js/desktop, @omega.js/extension), and the monorepo's
 * own scripts/watch-all.js (lock helpers + vendor propagation).
 */

// Libraries
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createRequire } = require('module');
const { safeInstall } = require('./safe-install');
const Logger = require('./logger');

// Constants
const SCOPE = '@omega.js/';
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
 * Map an @omega.js package name to its monorepo package directory.
 * @param {string} monorepoRoot - Monorepo root path.
 * @param {string} name - Package name (e.g. '@omega.js/client').
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
 * Collect an app's @omega.js dependencies from its package.json (the ONE
 * app manifest at the app root — scripts + runtime deps; src/dist pillar).
 * @param {string} appDir - App directory.
 * @returns {Array<{name: string, spec: string, dev: boolean, dir: string}>}
 */
function frameworkPackagesOf(appDir) {
  const entries = [];

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  } catch (e) {
    return entries;
  }
  for (const [depKey, dev] of [['dependencies', false], ['devDependencies', true]]) {
    for (const [name, spec] of Object.entries(pkg[depKey] || {})) {
      if (name.startsWith(SCOPE)) {
        entries.push({ name, spec, dev, dir: appDir });
      }
    }
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
 * Rewrite one dependency's spec in a manifest, preserving its dev/prod
 * placement (the same in-place rewrite npm does on --save).
 * @param {string} appDir - Directory holding the package.json.
 * @param {string} name - Dependency name.
 * @param {boolean} dev - Whether the entry lives in devDependencies.
 * @param {string} spec - New spec value.
 */
function setDependencySpec(appDir, name, dev, spec) {
  const manifestPath = path.join(appDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  pkg[dev ? 'devDependencies' : 'dependencies'][name] = spec;
  fs.writeFileSync(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * file: spec path — relative to the declaring manifest, forward slashes.
 * Computed from REAL paths on both ends: symlinks resolve physically, so a
 * spec relativized through an aliased view (macOS /var → /private/var, a
 * symlinked brand dir) would count the wrong number of ups and dangle.
 */
function relativeSpecPath(fromDir, target) {
  return path.relative(fs.realpathSync(fromDir), fs.realpathSync(target)).split(path.sep).join('/');
}

/**
 * file:-install a brand's @omega.js dependencies from the local monorepo.
 *
 * Tree-wide by construction: npm resolves the WHOLE workspace tree on any
 * install anchored in a brand monorepo, so linking one app while a SIBLING
 * app still carries an unpublished registry spec (`@omega.js/backend: *`)
 * 404s before anything links (the cp194 wizard-rehearsal catch — only
 * reachable in a brand OUTSIDE the omega monorepo, the real consumer
 * topology). Every app's @omega.js specs are therefore flipped to file:
 * first (dev/prod placement preserved — the entry is edited in place), then
 * ONE `npm install` materializes the links for the whole tree. Standalone
 * apps degenerate to themselves.
 *
 * Idempotent: dependencies already resolving to the monorepo copy are
 * skipped, and when nothing needs linking no install runs.
 * @param {object} options
 * @param {string} options.dir - App directory to link from (any app in the brand).
 * @param {string} options.monorepoRoot - Monorepo root path.
 * @param {object} [options.logger] - Logger with log/warn (silent when omitted).
 * @param {boolean} [options.dryRun] - Plan only, write and install nothing.
 * @returns {Promise<Array<{name: string, dir: string, target: string, action: 'link'|'skip'|'missing'}>>}
 */
async function linkLocalPackages(options) {
  const { dir, monorepoRoot, logger, dryRun } = options;
  const actions = [];

  const installRoot = findBrandRoot(dir);
  let installNeeded = false;

  // Manifest snapshots for rollback: every spec flips BEFORE the single
  // install, so an install failure must restore the originals — a
  // half-flipped tree is a quiet git-dirty diff someone could commit.
  const manifestBackups = new Map();
  const backupManifest = (appDir) => {
    const manifestPath = path.join(appDir, 'package.json');
    if (!manifestBackups.has(manifestPath)) {
      manifestBackups.set(manifestPath, fs.readFileSync(manifestPath, 'utf8'));
    }
  };

  for (const appDir of discoverApps(installRoot)) {
    for (const entry of frameworkPackagesOf(appDir)) {
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

      const spec = `file:${relativeSpecPath(entry.dir, target)}`;
      if (entry.spec === spec) {
        // Spec already correct, only the install is missing — no rewrite,
        // so a committed relative spec is never churned to a new layout.
        actions.push({ name: entry.name, dir: entry.dir, target, action: 'link' });
        logger && logger.log(`${entry.name}: spec already file: — installing`);
        installNeeded = true;
        continue;
      }

      actions.push({ name: entry.name, dir: entry.dir, target, action: 'link' });
      logger && logger.log(`${entry.name}: linking → ${target}`);
      installNeeded = true;
      if (!dryRun) {
        backupManifest(entry.dir);
        setDependencySpec(entry.dir, entry.name, entry.dev, spec);
      }
    }
  }

  if (installNeeded && !dryRun) {
    try {
      await safeInstall('npm install', { log: true, config: { cwd: installRoot } });
    } catch (error) {
      for (const [manifestPath, contents] of manifestBackups) {
        fs.writeFileSync(manifestPath, contents);
      }
      logger && logger.warn(`install failed — restored ${manifestBackups.size} manifest(s) to their pre-link specs`);
      throw error;
    }
  }

  return actions;
}

/**
 * Flip a brand tree's @omega.js `file:` specs back to registry ranges — the
 * publish-day inverse of linkLocalPackages(). Every file:-spec'd entry in
 * every app manifest becomes `^<version>` of the CURRENTLY LINKED copy (read
 * from the file: target's own package.json — no monorepo lookup, no registry
 * call, so it works on any machine), then ONE `npm install` re-resolves the
 * tree from the registry. Idempotent: registry-spec'd entries are untouched;
 * nothing to flip → no install. Same transactional manifest restore as the
 * linker when the install fails.
 * @param {object} options
 * @param {string} options.dir - Any directory inside the brand.
 * @param {object} [options.logger] - Logger with log/warn (silent when omitted).
 * @param {boolean} [options.dryRun] - Plan only, write and install nothing.
 * @param {string} [options.range] - Explicit range for every flipped entry (e.g. '^0.1.0').
 * @returns {Promise<Array<{name: string, dir: string, spec: string, action: 'flip'|'skip'|'unresolvable'}>>}
 */
async function restoreRegistrySpecs(options) {
  const { dir, logger, dryRun, range } = options;
  const actions = [];

  const installRoot = findBrandRoot(dir);
  let installNeeded = false;

  const manifestBackups = new Map();
  const backupManifest = (appDir) => {
    const manifestPath = path.join(appDir, 'package.json');
    if (!manifestBackups.has(manifestPath)) {
      manifestBackups.set(manifestPath, fs.readFileSync(manifestPath, 'utf8'));
    }
  };

  for (const appDir of discoverApps(installRoot)) {
    for (const entry of frameworkPackagesOf(appDir)) {
      if (!entry.spec.startsWith('file:')) {
        actions.push({ name: entry.name, dir: entry.dir, spec: entry.spec, action: 'skip' });
        continue;
      }

      let spec = range;
      if (!spec) {
        const target = path.resolve(appDir, entry.spec.slice('file:'.length));
        try {
          spec = `^${JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version}`;
        } catch (e) {
          actions.push({ name: entry.name, dir: entry.dir, spec: entry.spec, action: 'unresolvable' });
          logger && logger.warn(`${entry.name}: cannot read ${target}/package.json — pass { range } or fix the link`);
          continue;
        }
      }

      actions.push({ name: entry.name, dir: entry.dir, spec, action: 'flip' });
      logger && logger.log(`${entry.name}: ${entry.spec} → ${spec}`);
      installNeeded = true;
      if (!dryRun) {
        backupManifest(entry.dir);
        setDependencySpec(entry.dir, entry.name, entry.dev, spec);
      }
    }
  }

  if (installNeeded && !dryRun) {
    try {
      await safeInstall('npm install', { log: true, config: { cwd: installRoot } });
    } catch (error) {
      for (const [manifestPath, contents] of manifestBackups) {
        fs.writeFileSync(manifestPath, contents);
      }
      logger && logger.warn(`install failed — restored ${manifestBackups.size} manifest(s) to their file: specs`);
      throw error;
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
  // Forwarded child output keeps its OWN identity — these lines come from the
  // monorepo watch, not from whatever command spawned it, so they stamp
  // `[@omega.js/<host>:watch]` instead of borrowing the caller's logger (#12).
  const watchLogger = new Logger('watch');
  const forward = (stream) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) {
          watchLogger.log(line);
        }
      }
    });
  };
  forward(child.stdout);
  forward(child.stderr);
  logger && logger.log(`Monorepo watch started (pid ${child.pid}) — src→dist rebuilds are live`);

  return { alreadyRunning: false, pid: child.pid, child };
}

/**
 * Propagate vendored shared-package edits to the frameworks that embed them:
 * watch each vendorable package's src/ and re-run `npm run prepare` in the
 * dependents that actually vendor a changed package. A framework's own
 * prepare:watch only sees its OWN src, while the devkit/config/account copies
 * inside its dist/vendor/* refresh only on a full prepare — without this, a
 * shared-package edit strands every dist-running framework on stale vendored
 * code until a manual rebuild.
 *
 * Each pass is SCOPED (a dependent whose dist/vendor lacks every changed
 * package is skipped; a dependent with no vendor tree yet always runs — first
 * build) and CONCURRENT (independent prepares, no ordering contract). Edits
 * inside the debounce window fold into one pass; edits landing mid-pass queue
 * exactly one follow-up pass. A dependent's prepare failing is logged and
 * never stops the rest of the pass.
 * @param {object} options
 * @param {string} options.packagesDir - The monorepo's packages/ directory.
 * @param {string[]} options.packages - Vendorable package dir names to watch (missing src/ dirs are skipped).
 * @param {Array<{name: string, dir: string}>} options.dependents - Packages eligible for re-prepare.
 * @param {function} [options.runPrepare] - (dependent) => Promise; defaults to spawning `npm run prepare` in dependent.dir.
 * @param {function} [options.log] - Line logger (silent when omitted).
 * @param {number} [options.debounceMs] - Quiet window before a pass (default 400).
 * @returns {{watched: string[], poke: function, close: function}} poke(name)
 *   injects a change event without the fs (test seam — the fs watchers call
 *   the same path).
 */
function startVendorPropagation(options) {
  const { packagesDir, packages, dependents, log = () => {}, debounceMs = 400 } = options;

  const runPrepare = options.runPrepare || ((dependent) => new Promise((resolve) => {
    const child = spawn('npm', ['run', 'prepare'], { cwd: dependent.dir, stdio: ['ignore', 'pipe', 'pipe'] });

    // Quiet on success — surface output only when the prepare fails
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });

    child.on('error', (error) => {
      log(`prepare failed to spawn in ${dependent.name}: ${error.message}`);
      resolve();
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        log(`prepare exited ${code} in ${dependent.name}:\n${output.trim()}`);
      } else {
        log(`re-prepared ${dependent.name}`);
      }
      resolve();
    });
  }));

  let timer = null;
  let running = false;
  let pending = false;
  let closed = false;
  const dirty = new Set();

  const pass = async () => {
    running = true;
    do {
      pending = false;
      const changed = [...dirty];
      dirty.clear();

      // A spurious trigger with nothing dirty (fs watchers can replay stale
      // events under load) is a no-op, never a full re-prepare
      if (changed.length === 0) {
        continue;
      }

      // Scope: skip dependents whose dist/vendor embeds none of the changed
      // packages (a missing vendor tree means not-yet-prepared — always run)
      const affected = dependents.filter((dependent) => {
        const vendorRoot = path.join(dependent.dir, 'dist', 'vendor');
        return !fs.existsSync(vendorRoot)
          || changed.some((name) => fs.existsSync(path.join(vendorRoot, name)));
      });
      const skipped = dependents.length - affected.length;
      log(`${changed.join(', ')} changed — re-preparing ${affected.map((d) => d.name).join(', ') || '(none)'}${skipped > 0 ? ` (${skipped} unaffected)` : ''}`);

      if (closed) {
        break;
      }
      await Promise.all(affected.map((dependent) =>
        Promise.resolve()
          .then(() => runPrepare(dependent))
          .catch((error) => log(`prepare failed in ${dependent.name}: ${error.message}`))
      ));
    } while (pending && !closed);
    running = false;
  };

  const trigger = () => {
    if (closed) {
      return;
    }
    if (running) {
      pending = true;
      return;
    }
    pass();
  };

  const onSourceEvent = (name) => {
    if (closed) {
      return;
    }
    dirty.add(name);
    clearTimeout(timer);
    timer = setTimeout(trigger, debounceMs);
  };

  const watchers = [];
  const watched = [];
  for (const name of packages) {
    const srcDir = path.join(packagesDir, name, 'src');
    if (!fs.existsSync(srcDir)) {
      continue;
    }

    watchers.push(fs.watch(srcDir, { recursive: true }, () => onSourceEvent(name)));
    watched.push(name);
  }

  return {
    watched,
    poke: onSourceEvent,
    close: () => {
      closed = true;
      clearTimeout(timer);
      watchers.forEach((watcher) => watcher.close());
    },
  };
}

// The vendorable private packages folded into framework dists. Hardcoded here
// because this module must stay stdlib-only — tools/vendor.js
// VENDORABLE_PACKAGES is the SSOT (a devkit test pins the two lists equal).
const FRESHNESS_VENDORABLES = ['devkit', 'config', 'account', 'template-kit'];

// Directory names the freshness scan never descends into.
const FRESHNESS_SKIP_DIRS = new Set(['node_modules', '.temp', 'dist']);

/**
 * Newest mtime (ms) of any file or directory under dir, recursive — skipping
 * node_modules/.temp/dist and never following symlinks. Directory mtimes are
 * counted too, so a deletion (which touches only the parent dir) still reads
 * as a change. Missing dir → 0.
 * @param {string} dir - Directory to scan.
 * @returns {number} Newest mtimeMs, or 0 when nothing exists.
 */
function newestMtimeUnder(dir) {
  let newest = 0;
  const queue = [dir];

  while (queue.length > 0) {
    const current = queue.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
      newest = Math.max(newest, fs.statSync(current).mtimeMs);
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!FRESHNESS_SKIP_DIRS.has(entry.name)) {
          queue.push(abs);
        }
        continue;
      }
      if (entry.isFile()) {
        try {
          newest = Math.max(newest, fs.statSync(abs).mtimeMs);
        } catch (e) {
          // Raced deletion — skip
        }
      }
    }
  }

  return newest;
}

/**
 * Resolve a package's REAL on-disk directory as seen from fromDir, mirroring
 * Node resolution. require.resolve of '<name>/package.json' first (works when
 * there is no exports map — @omega.js/backend), then a manual node_modules
 * walk-up (exports maps rarely expose './package.json', and a missing dist
 * makes the '.' entry unresolvable — exactly the stale case this exists for).
 * @param {string} packageName - Package name (e.g. '@omega.js/web').
 * @param {string} fromDir - Directory to resolve from.
 * @returns {string|null} Real package directory, or null when unresolvable.
 */
function resolvePackageRealDir(packageName, fromDir) {
  try {
    const req = createRequire(path.join(fromDir, 'package.json'));
    return fs.realpathSync(path.dirname(req.resolve(`${packageName}/package.json`)));
  } catch (e) {
    // Fall through to the manual walk
  }

  let dir = path.resolve(fromDir);
  while (true) {
    const candidate = path.join(dir, 'node_modules', packageName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      try {
        return fs.realpathSync(candidate);
      } catch (e) {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Ensure a locally-linked framework's dist is at least as new as its src —
 * rebuilding it (`npm run prepare`) when a src edit landed without a prepare,
 * so consumers never run stale dist code just because nobody remembered to
 * rebuild (Ian's ask, 2026-07-20).
 *
 * Only acts on SOURCE CHECKOUTS: a registry install (real path still inside
 * node_modules) is untouched. Staleness compares the newest mtime under src/
 * against dist/ (missing dist = stale), and — for packages sitting in the
 * monorepo — also each embedded dist/vendor/<name> copy against that
 * vendorable package's src (vendored copies only refresh on a full prepare).
 * When the monorepo watch holds a live lock, the rebuild is left to it.
 * @param {object} options
 * @param {string} options.packageName - The package to check (e.g. '@omega.js/web').
 * @param {string} [options.fromDir] - Resolution origin (default process.cwd()).
 * @returns {{status: 'skipped'|'reexec-guard'|'registry'|'not-buildable'|'fresh'|'watch-owned'|'rebuilt'|'rebuild-failed', packageName: string, dir?: string}}
 */
function ensureFreshLocalDist(options) {
  const { packageName, fromDir = process.cwd() } = options;

  // Env seams: test/CI hatch, and the loop guard freshnessBoot sets on re-exec
  if (process.env.OMEGA_SKIP_FRESHNESS) {
    return { status: 'skipped', packageName };
  }
  if (process.env.OMEGA_FRESH_REEXEC) {
    return { status: 'reexec-guard', packageName };
  }

  const realDir = resolvePackageRealDir(packageName, fromDir);
  if (!realDir || realDir.split(path.sep).includes('node_modules')) {
    // Unresolvable (bootstrap dir, nothing installed) or a real registry
    // install — either way there is no local source checkout to freshen
    return { status: 'registry', packageName, dir: realDir || undefined };
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(realDir, 'package.json'), 'utf8'));
  } catch (e) {
    pkg = null;
  }
  const srcDir = path.join(realDir, 'src');
  if (!fs.existsSync(srcDir) || !(pkg && pkg.scripts && pkg.scripts.prepare)) {
    return { status: 'not-buildable', packageName, dir: realDir };
  }

  const distDir = path.join(realDir, 'dist');
  let stale = !fs.existsSync(distDir) || newestMtimeUnder(srcDir) > newestMtimeUnder(distDir);

  // Vendored shared-package copies: a devkit/config/account/template-kit edit
  // only lands in dist/vendor/<name> via a full prepare — an up-to-date own-src
  // dist can still be stale on vendored code (the cp184 class of bug)
  const monorepoRoot = path.dirname(path.dirname(realDir));
  const inMonorepo = isMonorepoRoot(monorepoRoot);
  if (!stale && inMonorepo) {
    for (const name of FRESHNESS_VENDORABLES) {
      const vendorDir = path.join(distDir, 'vendor', name);
      if (fs.existsSync(vendorDir)
        && newestMtimeUnder(path.join(monorepoRoot, 'packages', name, 'src')) > newestMtimeUnder(vendorDir)) {
        stale = true;
        break;
      }
    }
  }

  if (!stale) {
    return { status: 'fresh', packageName, dir: realDir };
  }

  if (inMonorepo && readLiveWatchPid(monorepoRoot)) {
    console.log(`\x1b[2momega: local ${packageName} dist is stale — the monorepo watch will rebuild it\x1b[0m`);
    return { status: 'watch-owned', packageName, dir: realDir };
  }

  console.log(`omega: local ${packageName} dist is stale — rebuilding…`);
  const result = spawnSync('npm', ['run', 'prepare'], {
    cwd: realDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.warn(`omega: rebuild failed (npm run prepare exited ${result.status === null ? String(result.error && result.error.message || 'spawn error') : result.status} in ${realDir}) — continuing on the stale dist`);
    return { status: 'rebuild-failed', packageName, dir: realDir };
  }
  return { status: 'rebuilt', packageName, dir: realDir };
}

// One freshness scan per process per module instance — a dispatcher hop that
// re-enters the SAME framework's run() must not scan (or rebuild) twice.
let freshnessBootRan = false;

/**
 * CLI-boot wiring for ensureFreshLocalDist: every framework run() calls this
 * first. On a rebuild, the running process booted from the STALE dist — so the
 * same invocation re-execs ONCE (OMEGA_FRESH_REEXEC guards the loop) and this
 * process exits with the child's status. Every other outcome returns and the
 * boot continues.
 * @param {object} options - Same as ensureFreshLocalDist.
 * @returns {{status: string, packageName: string, dir?: string}}
 */
function freshnessBoot(options) {
  if (freshnessBootRan) {
    return { status: 'already-checked', packageName: options.packageName };
  }
  freshnessBootRan = true;

  const result = ensureFreshLocalDist(options);
  if (result.status !== 'rebuilt') {
    return result;
  }

  const child = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { OMEGA_FRESH_REEXEC: '1' }),
  });
  process.exit(child.status === null ? 1 : child.status);
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
  restoreRegistrySpecs,
  startMonorepoWatch,
  startVendorPropagation,
  readLiveWatchPid,
  acquireWatchLock,
  releaseWatchLock,
  FRESHNESS_VENDORABLES,
  ensureFreshLocalDist,
  freshnessBoot,
};
