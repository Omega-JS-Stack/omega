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
 * - ensureFreshLocalDist() / freshnessBoot() — check a locally-linked
 *   framework's dist (and its @omega.js/* runtime deps') at CLI boot: a link
 *   into the monorepo is read-only and stops the boot loudly, any other local
 *   checkout is rebuilt and the invocation re-execs once
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

  // This prepare takes the dependent's heal lock for the child's whole life:
  // it writes the same dist a booting CLI's heal rebuilds, so the two must
  // never run at once. The wait is async — the watcher keeps serving its other
  // watches while a peer's prepare finishes.
  const runPrepare = options.runPrepare || ((dependent) => acquireHealLock(dependent.dir).then((release) => new Promise((resolve) => {
    const done = () => {
      release();
      resolve();
    };
    const child = spawn('npm', ['run', 'prepare'], { cwd: dependent.dir, stdio: ['ignore', 'pipe', 'pipe'] });

    // Quiet on success — surface output only when the prepare fails
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });

    child.on('error', (error) => {
      log(`prepare failed to spawn in ${dependent.name}: ${error.message}`);
      done();
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        log(`prepare exited ${code} in ${dependent.name}:\n${output.trim()}`);
      } else {
        log(`re-prepared ${dependent.name}`);
      }
      done();
    });
  })));

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

// Dist paths prepare legitimately generates with no src counterpart, so their
// presence is never "a src file was deleted": the vendor hook's module copies
// (dist/vendor/**). Nothing else — vendor-docs writes to the package ROOT
// docs/ and prepare-package rewrites the ROOT package.json, so a dist/docs or
// dist/package.json IS a leftover. A host's declared `omega.vendorAssets`
// destinations join the set per package (see allowedDistExtras) — that is how
// desktop/extension end up with a dist/assets tree the web package owns.
const DIST_EXTRAS = ['vendor'];

// The one dist subtree the orphan scan skips entirely: a package's self-tests
// SEED runtime state into dist/test/fixtures/ (backend writes its fixture
// project's firestore.rules and service-account.json there). Nothing in it can
// shadow a consumer require, and the exemption survives a crashed run where a
// teardown would not (#352). Files there WITH a src counterpart still age.
const DIST_FIXTURE_STATE = 'test/fixtures/';

// The per-package heal mutex (mkdir-as-mutex, owner pid inside) — .omega/ is
// gitignored monorepo-wide, so the lock never dirties a package.
const HEAL_LOCK = path.join('.omega', 'heal.lock');
// A prepare legitimately holds the lock for minutes, so the loser waits long
// and only ever proceeds unlocked as a last resort — a heal must never fail
// over its own bookkeeping.
const HEAL_LOCK_WAIT_MS = 120000;
const HEAL_LOCK_POLL_MS = 50;
// Grace for the window between mkdir and the owner file landing: a lock with no
// readable owner is only abandoned once it is older than this.
const HEAL_LOCK_ORPHAN_MS = 5000;

// Bounded grace for an in-flight watcher copy before the boot heals anyway.
const WATCH_GRACE_MS = 2000;
const WATCH_POLL_MS = 100;

/**
 * Synchronous wait — this whole path is sync by design (it runs before a CLI's
 * first await, and freshnessBoot may re-exec the process).
 * @param {number} ms - Milliseconds to block.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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
 * Newest mtime (ms) of a path that may be a FILE or a directory — a declared
 * `omega.vendorAssets` entry names either shape. Missing path → 0.
 * @param {string} target - File or directory to measure.
 * @returns {number} Newest mtimeMs, or 0 when nothing exists.
 */
function newestMtimeOf(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (e) {
    return 0;
  }

  return stat.isDirectory() ? newestMtimeUnder(target) : stat.mtimeMs;
}

/**
 * Every file under dir, keyed by its dir-relative POSIX path — skipping
 * node_modules/.temp/dist and never following symlinks (a framework dist can
 * carry a circular self-link fixture). Missing dir → empty map.
 * @param {string} dir - Directory to scan.
 * @returns {Map<string, number>} relative path → mtimeMs.
 */
function filesUnder(dir) {
  const files = new Map();
  const queue = [''];

  while (queue.length > 0) {
    const relative = queue.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(dir, relative), { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!FRESHNESS_SKIP_DIRS.has(entry.name)) {
          queue.push(child);
        }
        continue;
      }
      if (entry.isFile()) {
        try {
          files.set(child, fs.statSync(path.join(dir, child)).mtimeMs);
        } catch (e) {
          // Raced deletion — skip
        }
      }
    }
  }

  return files;
}

/**
 * The dist paths a prepare of THIS package generates without a src counterpart:
 * the standing set (`dist/vendor/**`) plus every `omega.vendorAssets`
 * destination the host declares (each is a dist-relative file or directory the
 * vendor hook copies from another package).
 * @param {object|null} pkg - The package's manifest.
 * @returns {string[]} Dist-relative POSIX paths (files or directory roots).
 */
function allowedDistExtras(pkg) {
  const declared = ((pkg && pkg.omega && pkg.omega.vendorAssets) || [])
    .map((entry) => entry && entry.to)
    .filter(Boolean)
    .map((to) => to.split(path.sep).join('/').replace(/^\.\//, '').replace(/\/+$/, ''));

  return DIST_EXTRAS.concat(declared);
}

/**
 * Per-file staleness evidence for a locally-linked package's dist.
 *
 * A whole-tree newest-mtime compare is not enough: prepare's after-hook writes
 * into dist too (vendored modules, declared assets), so ANY dist write
 * after a src edit made the tree read "fresh" while individual dist files were
 * stale or missing outright (the 2026-08-05 incident). Evidence instead: every
 * src file must exist at its mapped dist path with an mtime at least as new, no
 * dist file may lack a src counterpart (a deleted source) unless prepare
 * generates it, and — inside the monorepo — each embedded dist/vendor/<name>
 * copy must be newer than that private package's src, and each declared
 * `omega.vendorAssets` destination newer than the sibling package's source it
 * was copied from (both kinds of copy only refresh on a full prepare).
 * @param {object} options
 * @param {string} options.srcDir - The package's src directory.
 * @param {string} options.distDir - The package's dist directory.
 * @param {object|null} options.pkg - The package's manifest.
 * @param {string} options.monorepoRoot - Monorepo root (only read when inMonorepo).
 * @param {boolean} options.inMonorepo - Whether the package lives in the monorepo.
 * @returns {string|null} The first piece of evidence, or null when fresh.
 */
function distStaleReason(options) {
  const { srcDir, distDir, pkg, monorepoRoot, inMonorepo } = options;

  if (!fs.existsSync(distDir)) {
    return 'dist/ is missing';
  }

  const srcFiles = filesUnder(srcDir);
  const distFiles = filesUnder(distDir);

  for (const [relative, mtime] of srcFiles) {
    const distMtime = distFiles.get(relative);
    if (distMtime === undefined) {
      return `dist/${relative} is missing`;
    }
    if (mtime > distMtime) {
      return `dist/${relative} is older than src/${relative}`;
    }
  }

  const extras = allowedDistExtras(pkg);
  for (const relative of distFiles.keys()) {
    if (srcFiles.has(relative) || relative.startsWith(DIST_FIXTURE_STATE)) {
      continue;
    }
    if (!extras.some((extra) => relative === extra || relative.startsWith(`${extra}/`))) {
      return `dist/${relative} has no src counterpart (deleted source)`;
    }
  }

  if (inMonorepo) {
    for (const name of FRESHNESS_VENDORABLES) {
      const vendorDir = path.join(distDir, 'vendor', name);
      if (fs.existsSync(vendorDir)
        && newestMtimeUnder(path.join(monorepoRoot, 'packages', name, 'src')) > newestMtimeUnder(vendorDir)) {
        return `dist/vendor/${name} is older than packages/${name}/src`;
      }
    }

    // The declared assets the orphan scan above exempts: that exemption stopped
    // the false "deleted source" hits, but it left the destinations with NO
    // freshness question at all, so an edit to web's core/ or themes/ never made
    // desktop/extension stale and a watcher-down boot served the old copy
    // (#199). The source is a monorepo sibling package (the vendor hook copies
    // it verbatim, no build step), so the inMonorepo guard skips the loop on a
    // published install — where there is no sibling to compare against.
    for (const entry of (pkg && pkg.omega && pkg.omega.vendorAssets) || []) {
      if (!entry || !entry.package || !entry.from || !entry.to) {
        continue; // Malformed — the vendor hook is the one that fails on it
      }
      if (!entry.package.startsWith('@omega.js/')) {
        continue; // Foreign scope — the short-name → packages/<name> mapping below only holds for ours
      }
      const sourceMtime = newestMtimeOf(path.join(monorepoRoot, 'packages', entry.package.split('/').pop(), entry.from));
      if (sourceMtime === 0) {
        // A wrong `from` (rename/typo) lands here too and stays silent — the
        // vendor hook's warning owns that mistake; returning stale instead
        // would loop a full prepare on every boot with nothing to fix it
        continue;
      }
      const destination = path.join(distDir, entry.to);
      if (!fs.existsSync(destination)) {
        return `dist/${entry.to} was never vendored from ${entry.package}'s ${entry.from}`;
      }
      if (sourceMtime > newestMtimeOf(destination)) {
        return `dist/${entry.to} is older than ${entry.package}'s ${entry.from}`;
      }
    }
  }

  return null;
}

/**
 * Whether a held heal lock can be stolen: its owner process is gone, or the
 * lock has no readable owner and is older than the mkdir→write grace (the
 * holder died mid-acquire).
 * @param {string} lockDir - The lock directory.
 * @returns {boolean}
 */
function healLockAbandoned(lockDir) {
  let pid;
  try {
    pid = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8')).pid;
  } catch (e) {
    try {
      return Date.now() - fs.statSync(lockDir).mtimeMs > HEAL_LOCK_ORPHAN_MS;
    } catch (statError) {
      return false; // Lock vanished — the caller's next mkdir wins it
    }
  }

  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    // Only "no such process" means gone: EPERM is a LIVE process this user may
    // not signal, and stealing its lock would double the build it is running
    return e.code === 'ESRCH';
  }
}

/**
 * Make the lock's parent (`<package>/.omega`) — the one piece of bookkeeping
 * that must exist before any mkdir-as-mutex attempt.
 * @param {string} lockDir - The lock directory.
 * @returns {boolean} False when the dir is unmakeable (read-only fs, full
 *   disk) — the caller then proceeds unlocked rather than failing the heal.
 */
function ensureHealLockParent(lockDir) {
  try {
    fs.mkdirSync(path.dirname(lockDir), { recursive: true });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * ONE attempt at the mkdir-as-mutex, stealing an abandoned lock and retrying
 * once. Never throws: a heal must not fail over its own bookkeeping.
 * @param {string} lockDir - The lock directory.
 * @returns {boolean} Whether this process now holds the lock.
 */
function tryHealLock(lockDir) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(lockDir);
    } catch (e) {
      if (attempt === 0 && healLockAbandoned(lockDir)) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      return false;
    }
    try {
      fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    } catch (e) {
      // The owner file is liveness evidence, not the mutex itself — a lock
      // nobody can read is only abandoned after the orphan grace, which is
      // exactly the right answer for a holder that could not write it
    }
    return true;
  }

  return false;
}

/**
 * Release a held heal lock. Idempotent — a spawn that emits both 'error' and
 * 'exit' must never delete a lock a LATER process has since won.
 * @param {string} lockDir - The lock directory.
 * @returns {function} The release function.
 */
function healLockReleaser(lockDir) {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    fs.rmSync(lockDir, { recursive: true, force: true });
  };
}

/**
 * Run fn under the package's cross-process heal lock, so two CLIs booting on
 * the same stale link produce ONE build. The loser waits for the winner (a
 * prepare can run for minutes), an abandoned lock is stolen, and a wait that
 * outlives the deadline proceeds unlocked rather than failing the boot.
 * @param {string} realDir - The package directory.
 * @param {function} fn - Critical section.
 * @returns {*} fn's result.
 */
function withHealLock(realDir, fn) {
  const lockDir = path.join(realDir, HEAL_LOCK);
  const deadline = Date.now() + HEAL_LOCK_WAIT_MS;
  let release = null;

  if (ensureHealLockParent(lockDir)) {
    while (true) {
      if (tryHealLock(lockDir)) {
        release = healLockReleaser(lockDir);
        break;
      }
      if (Date.now() >= deadline) {
        break;
      }
      sleepSync(HEAL_LOCK_POLL_MS);
    }
  }

  try {
    return fn();
  } finally {
    if (release) {
      release();
    }
  }
}

/**
 * The same heal lock, awaited WITHOUT blocking: the watch process takes it
 * around its own `npm run prepare` spawn, and must keep serving its other
 * watchers while a peer's prepare finishes (never sleepSync here).
 * @param {string} realDir - The package directory.
 * @returns {Promise<function>} Resolves to a release function — always safe to
 *   call, including when the wait timed out and the caller proceeds unlocked.
 */
function acquireHealLock(realDir) {
  const lockDir = path.join(realDir, HEAL_LOCK);
  const unlocked = () => {};
  if (!ensureHealLockParent(lockDir)) {
    return Promise.resolve(unlocked);
  }

  const deadline = Date.now() + HEAL_LOCK_WAIT_MS;
  return new Promise((resolve) => {
    const attempt = () => {
      if (tryHealLock(lockDir)) {
        resolve(healLockReleaser(lockDir));
        return;
      }
      if (Date.now() >= deadline) {
        resolve(unlocked);
        return;
      }
      setTimeout(attempt, HEAL_LOCK_POLL_MS);
    };
    attempt();
  });
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
 * Whether a resolved directory is a SOURCE CHECKOUT rather than a registry
 * install: a real path still inside node_modules is installed, and an
 * unresolvable package is nothing at all.
 * @param {string|null} realDir - Resolved package directory.
 * @returns {boolean}
 */
function isLocalCheckout(realDir) {
  return Boolean(realDir) && !realDir.split(path.sep).includes('node_modules');
}

/**
 * Read a package's manifest.
 * @param {string} realDir - The package directory.
 * @returns {object|null} The manifest, or null when it is unreadable.
 */
function readPackageManifest(realDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(realDir, 'package.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

// One watch-down warning per process, however many packages get checked.
let warnedWatchDown = false;

/**
 * Warn once that the monorepo's src→dist watch is not running: every framework
 * CLI boots through the freshness path, so all five surfaces get this for free.
 * @param {string} monorepoRoot - Monorepo root path.
 */
function warnWatchDown(monorepoRoot) {
  if (warnedWatchDown) {
    return;
  }
  warnedWatchDown = true;
  console.warn(`omega: the monorepo src→dist watch is not running: nothing rebuilds a linked package's dist, so run \`npm start\` in ${monorepoRoot} before building against it`);
}

/**
 * The loud stop for a monorepo-linked package whose dist is missing or stale
 * (#281). A consumer build does not fix it: the package belongs to the monorepo
 * and its watch, so the build says what is unbuilt, where, and what to start.
 * @param {object} result - A 'stale-linked' ensureFreshLocalDist result.
 * @returns {string} The multi-line message, stderr-bound.
 */
function staleLinkedMessage(result) {
  return [
    '',
    `omega: ${result.packageName} is linked into the omega monorepo and its dist is not built (${result.reason}).`,
    `omega: linked packages are read-only to consumer builds, so this build will not rebuild ${result.dir}.`,
    result.watching
      ? `omega: the monorepo watch (\`npm start\` in ${result.monorepoRoot}) is running but has not landed that build yet: give it a moment, then re-run this command.`
      : `omega: the monorepo watch owns that dist: run \`npm start\` in ${result.monorepoRoot} (one-off: \`npm run prepare -w ${result.packageName}\`), then re-run this command.`,
    '',
  ].join('\n');
}

/**
 * Check that a locally-linked framework's dist is at least as new as its src —
 * reporting or rebuilding it when a src edit landed without a prepare, so
 * consumers never run stale dist code just because nobody remembered to
 * rebuild (Ian's ask, 2026-07-20).
 *
 * Only acts on SOURCE CHECKOUTS: a registry install (real path still inside
 * node_modules) is untouched. Staleness is PER-FILE evidence (distStaleReason),
 * never a whole-tree mtime compare. A live monorepo watch buys a bounded grace
 * for its in-flight copy — then the check reports anyway, because a watcher that
 * silently died is exactly what let a stale dist serve for a day (#195).
 *
 * A link into the OMEGA MONOREPO is read-only here (#281): that checkout is
 * shared (a fleet of agents, several brands, the monorepo's own processes), so
 * a consumer build never prepares it in place — a prepare purges the dist a
 * sibling process is mid-require on, and refetches network caches, all of it
 * invisible to git. Those come back 'stale-linked' and freshnessBoot stops the
 * invocation loudly. Any other local checkout (a link with no watch behind it)
 * still heals, under the package's cross-process lock so N booting CLIs produce
 * one build.
 * @param {object} options
 * @param {string} options.packageName - The package to check (e.g. '@omega.js/web').
 * @param {string} [options.fromDir] - Resolution origin (default process.cwd()).
 * @returns {{status: 'skipped'|'reexec-guard'|'registry'|'not-buildable'|'fresh'|'rebuilt'|'stale-linked'|'rebuild-failed', by?: 'self'|'watch'|'peer', packageName: string, dir?: string, reason?: string, monorepoRoot?: string, watching?: boolean}}
 *   Every HEALED outcome is 'rebuilt' — `by` only says who built it — because
 *   whoever built it, this process booted from the pre-heal dist and must
 *   re-exec.
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
  if (!isLocalCheckout(realDir)) {
    // Unresolvable (bootstrap dir, nothing installed) or a real registry
    // install — either way there is no local source checkout to freshen
    return { status: 'registry', packageName, dir: realDir || undefined };
  }

  const pkg = readPackageManifest(realDir);
  const srcDir = path.join(realDir, 'src');
  if (!fs.existsSync(srcDir) || !(pkg && pkg.scripts && pkg.scripts.prepare)) {
    return { status: 'not-buildable', packageName, dir: realDir };
  }

  const distDir = path.join(realDir, 'dist');
  const monorepoRoot = path.dirname(path.dirname(realDir));
  const inMonorepo = isMonorepoRoot(monorepoRoot);
  const watchPid = inMonorepo ? readLiveWatchPid(monorepoRoot) : null;

  // Liveness: a monorepo-linked CLI booting with no watch running still heals
  // itself below, but src→dist propagation is only as live as this boot — say
  // so once, loudly, instead of letting a dead watcher go unnoticed for a day
  if (inMonorepo && !watchPid) {
    warnWatchDown(monorepoRoot);
  }

  const staleness = () => distStaleReason({ srcDir, distDir, pkg, monorepoRoot, inMonorepo });
  let reason = staleness();
  if (!reason) {
    return { status: 'fresh', packageName, dir: realDir };
  }

  // A live watch owns the copy — give its in-flight write a bounded moment to
  // land, then heal anyway (blind trust of the lock is what masked #195)
  if (watchPid) {
    const deadline = Date.now() + WATCH_GRACE_MS;
    while (Date.now() < deadline) {
      sleepSync(WATCH_POLL_MS);
      reason = staleness();
      if (!reason) {
        console.log(`\x1b[2momega: local ${packageName} dist was stale — the monorepo watch rebuilt it\x1b[0m`);
        return { status: 'rebuilt', by: 'watch', packageName, dir: realDir };
      }
    }
  }

  // Linked into the monorepo: the watch owns this dist, and a consumer build
  // owns nothing here (#281). Report it and let the boot stop the invocation.
  if (inMonorepo) {
    return { status: 'stale-linked', packageName, dir: realDir, reason, monorepoRoot, watching: Boolean(watchPid) };
  }

  return withHealLock(realDir, () => {
    // The lock loser arrives after the winner's prepare: re-check instead of
    // building again — running twice equals running once. Still a HEAL, so it
    // re-execs like any other: this process's modules came from the stale dist
    reason = staleness();
    if (!reason) {
      return { status: 'rebuilt', by: 'peer', packageName, dir: realDir };
    }

    console.log(`omega: local ${packageName} dist is stale (${reason}) — rebuilding…`);
    const result = spawnSync('npm', ['run', 'prepare'], {
      cwd: realDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
      console.warn(`omega: rebuild failed (npm run prepare exited ${result.status === null ? String(result.error && result.error.message || 'spawn error') : result.status} in ${realDir}) — continuing on the stale dist`);
      return { status: 'rebuild-failed', packageName, dir: realDir };
    }
    return { status: 'rebuilt', by: 'self', packageName, dir: realDir };
  });
}

/**
 * The ordered list of packages ONE boot checks: the CLI host plus every
 * `@omega.js/*` RUNTIME dependency reachable from it through local checkouts.
 *
 * The host alone is not enough: web's bundle carries `@omega.js/client`'s dist
 * verbatim, so a boot that heals web and stops there still serves the browser a
 * stale client (#198). devDependencies are never walked — nothing a consumer
 * RUNS comes from them. A dep that resolves into node_modules (registry
 * install) or nowhere stays on the list — ensureFreshLocalDist classifies it —
 * but its own deps do not, because there is no local source under it to go
 * stale. Each dep resolves from ITS depender's real dir, so the walk follows
 * the actual node_modules chain rather than guessing a layout.
 *
 * Order is post-order — DEPS FIRST, host LAST — so a host prepare that consumes
 * a dep's artifacts (vendored copies, bundled dists) sees the freshened ones.
 * @param {object} options
 * @param {string} options.packageName - The CLI host package.
 * @param {string} [options.fromDir] - Resolution origin (default process.cwd()).
 * @returns {Array<{packageName: string, fromDir: string}>} ensureFreshLocalDist arguments, in check order.
 */
function freshnessCheckList(options) {
  const { packageName, fromDir = process.cwd() } = options;
  const list = [];
  const visited = new Set();

  const walk = (name, origin) => {
    if (visited.has(name)) {
      return; // A cycle or a diamond — one check per package either way
    }
    visited.add(name);

    const realDir = resolvePackageRealDir(name, origin);
    if (isLocalCheckout(realDir)) {
      const dependencies = (readPackageManifest(realDir) || {}).dependencies || {};
      for (const dep of Object.keys(dependencies)) {
        if (dep.startsWith(SCOPE)) {
          walk(dep, realDir);
        }
      }
    }

    list.push({ packageName: name, fromDir: origin });
  };

  walk(packageName, fromDir);
  return list;
}

// One freshness scan per process per module instance — a dispatcher hop that
// re-enters the SAME framework's run() must not scan (or rebuild) twice.
let freshnessBootRan = false;

/**
 * CLI-boot wiring for ensureFreshLocalDist: every framework run() calls this
 * first, naming the HOST package — and the boot checks the host's whole
 * `@omega.js/*` runtime dependency closure (freshnessCheckList), deps first,
 * because the host's dist is not the only code this invocation serves (#198).
 * On a rebuild ANYWHERE in that list, the running process booted from the STALE
 * dist — so the same invocation re-execs ONCE (OMEGA_FRESH_REEXEC guards the
 * loop) and this process exits with the child's status. That is EVERY heal,
 * whoever built it (`by: self|watch|peer`): a dist the watch or a peer CLI
 * rebuilt leaves this process just as stale as one it rebuilt itself.
 *
 * A 'stale-linked' entry is the LOUD STOP (#281): the package lives in the
 * shared monorepo, nothing here may build it, and running on a dist nobody
 * built is the silent fallback the ruling forbids — so the boot prints what is
 * unbuilt and exits 1 before the verb runs. Every other outcome returns the
 * HOST's result and the boot continues.
 * @param {object} options - Same as ensureFreshLocalDist (packageName = the host).
 * @returns {{status: string, by?: string, packageName: string, dir?: string}}
 */
function freshnessBoot(options) {
  if (freshnessBootRan) {
    return { status: 'already-checked', packageName: options.packageName };
  }
  freshnessBootRan = true;

  // The whole list runs even after a heal: a dep rebuild can leave its
  // dependents stale in turn, and the re-exec below covers them all at once
  let result = null;
  let healed = false;
  for (const entry of freshnessCheckList(options)) {
    const entryResult = ensureFreshLocalDist(entry);
    if (entryResult.status === 'stale-linked') {
      console.error(staleLinkedMessage(entryResult));
      process.exit(1);
    }
    healed = healed || entryResult.status === 'rebuilt';
    if (entry.packageName === options.packageName) {
      result = entryResult; // The host is last — its result is the boot's
    }
  }

  if (!healed) {
    return result;
  }

  const child = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { OMEGA_FRESH_REEXEC: '1' }),
  });
  process.exit(child.status === null ? 1 : child.status);
}

/**
 * ONE freshness pass for a FAN-OUT, run BEFORE it (#340): the brand-root
 * `omega dev` sweeps every lane's host closure in this process, then spawns the
 * lanes — each lane's own freshnessBoot then finds nothing to do.
 *
 * Why it must be hoisted: a heal runs `npm run prepare`, which PURGES dist
 * before recopying, and a lane's framework bin opens by loading its own built
 * dist entry. Two lanes checking themselves in parallel means one lane's purge
 * window is the other lane's require — the backend lane died MODULE_NOT_FOUND
 * dispatching through the web package the web lane was mid-rebuild on. The heal lock does
 * not help: it serializes BUILDS, and the casualty is a bystander require.
 *
 * The lanes' closures overlap almost entirely (they share the brand's
 * node_modules), so entries are deduped by the package DIRECTORY they resolve
 * to — one check per real package, deps-first per host (freshnessCheckList).
 *
 * Nothing here re-execs, unlike freshnessBoot: what this pass heals is the
 * LANES' code, which no lane has loaded yet — this process's own closure was
 * settled by its CLI-boot freshnessBoot. That is also why the re-exec loop
 * guard is lifted for the pass: a dev boot that re-execed after healing its own
 * host must still hoist the lanes' check, or the fan-out races exactly as before.
 *
 * A 'stale-linked' entry (a monorepo link, read-only here — #281) is REPORTED,
 * message and all, and returned: the caller stops the boot before any lane
 * spawns, instead of each lane discovering it separately, half-booted.
 * @param {object} options
 * @param {Array<{packageName: string, fromDir: string}>} options.hosts - One entry
 *   per lane: the framework package that lane runs, and the app dir it resolves from.
 * @returns {{checked: object[], healed: string[], staleLinked: object[], failed: string[]}}
 *   checked = every ensureFreshLocalDist result, in check order.
 */
function freshnessSweep(options) {
  const { hosts = [] } = options;

  const entries = [];
  const seen = new Set();
  for (const host of hosts) {
    for (const entry of freshnessCheckList(host)) {
      // The resolved dir is the identity — the same package reached from two
      // apps is ONE dist. Unresolvable entries keep their own key so
      // ensureFreshLocalDist still gets to classify them.
      const key = resolvePackageRealDir(entry.packageName, entry.fromDir) || `${entry.packageName}\u0000${entry.fromDir}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push(entry);
    }
  }

  const priorReexec = process.env.OMEGA_FRESH_REEXEC;
  delete process.env.OMEGA_FRESH_REEXEC;

  const checked = [];
  try {
    for (const entry of entries) {
      checked.push(ensureFreshLocalDist(entry));
    }
  } finally {
    if (priorReexec !== undefined) {
      process.env.OMEGA_FRESH_REEXEC = priorReexec;
    }
  }

  const staleLinked = checked.filter((result) => result.status === 'stale-linked');
  for (const result of staleLinked) {
    console.error(staleLinkedMessage(result));
  }

  return {
    checked,
    healed: checked.filter((result) => result.status === 'rebuilt').map((result) => result.packageName),
    staleLinked,
    failed: checked.filter((result) => result.status === 'rebuild-failed').map((result) => result.packageName),
  };
}

// Exports
module.exports = {
  DEFAULT_MONOREPO,
  WATCH_LOCK,
  HEAL_LOCK,
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
  freshnessCheckList,
  freshnessBoot,
  freshnessSweep,
};
