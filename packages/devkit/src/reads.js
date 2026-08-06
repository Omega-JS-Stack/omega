/**
 * Dependency-tracked config reads (#200). Devkit-homed (the build-time
 * harmonization ruling, docs/shared/rulings.md): any framework dev loop may
 * adopt it; @omega.js/web is the first consumer. Every config-time filesystem
 * read goes through this helper, and READING IS THE REGISTRATION: each
 * call records the directory it touched into the active capture scope, and
 * `omega dev` watches the recorded union for config resets. No caller ever
 * maintains a watch list, so a capture added later cannot drift out of the
 * watch set — the hand list was the thing that kept forgetting (#139).
 *
 * The recording rules live HERE, never in the callers:
 *   - DIRECTORY granularity: a file read records its dirname. One dir is one
 *     watch target (the watcher walks it recursively anyway), and per-file
 *     targets would multiply with every page of a real brand.
 *   - A MISS still arms: probing a dir/file that does not exist records the
 *     directory anyway, so a brand that authors src/_includes mid-session gets
 *     its reset without a restart (the unconditional-arm idiom).
 *   - REALPATH outside the consumer dir: a linked brand reaches the framework
 *     through a `node_modules/@omega.js/web` symlink, and Eleventy's watcher
 *     ignores that whole subtree — the resolved path sidesteps it (#134).
 *     Consumer-dir paths are recorded as read; the dev loop derives them from
 *     cwd, which is already resolved.
 *   - CONTAINMENT pruning: every watcher over a recorded dir is recursive, so a
 *     recorded dir with a recorded ancestor is the same target twice. Only the
 *     shallowest survives (a section library alone records one dir per entry
 *     folder — 83 targets on the playground brand, 14 after pruning).
 *
 * Two KINDS of capture (#200):
 *   - `reset` (Lane A, the default): the product is baked into the Eleventy
 *     config, so a change rebuilds the whole config.
 *   - `rescan` (Lane B, `reads.rescan(run)`): the product gates per-page
 *     decisions the render consults LIVE, so a change re-runs just `run` — no
 *     config reset, which is what keeps ordinary page edits on Eleventy's
 *     incremental lane. A dir both lanes read stays `reset`: the config itself
 *     depends on it, and a reset covers the rescan too.
 *
 * Scope lifecycle: `configureOmega` opens ONE scope per config build and
 * closes it on the way out, so every config-time read is inside one. `omega
 * dev` arms `onNextScope` before the engine runs and registers the union when
 * the scope closes (web's src/commands/dev.js). Everywhere else — the boot phase,
 * the asset lane, `omega build` — no scope is open and recording is a no-op:
 * the reads still work, they just record nothing.
 */
const fs = require('node:fs');
const path = require('node:path');

// The active capture scope: { consumerDir, dirs: Map<string, entry>, handler,
// rescan }. An entry is { kind, reruns: Set<function> }; `rescan` is the
// capture currently running, if any. One scope at a time — config builds never
// nest.
let scope = null;

// The handler armed for the NEXT scope (dev.js, before the engine runs).
let armed = null;

/**
 * Arm a handler for the next capture scope: it receives that scope's recorded
 * targets when the scope closes. Armed for ONE scope — every config build arms
 * its own.
 * @param {function} handler - (targets) => void
 */
function onNextScope(handler) {
  armed = handler;
}

/**
 * Open a capture scope. Any scope still open is replaced — a config build that
 * threw halfway leaves one behind, and the next build must still record.
 * @param {object} options
 * @param {string} [options.consumerDir] - the Eleventy input dir (paths under
 *   it are recorded as read; everything else resolves through realpath)
 */
function openScope(options) {
  const consumerDir = options && options.consumerDir;
  scope = {
    consumerDir: consumerDir ? path.resolve(consumerDir) : null,
    dirs: new Map(),
    handler: armed,
    rescan: null,
  };
  armed = null;
}

/**
 * Close the active capture scope and hand its unions to the armed handler:
 * the reset targets first (the dev loop registers them with Eleventy), the
 * rescan targets second (the dev loop's own light watcher).
 * @returns {Array<{ dir: string, kind: string }>} the recorded reset union
 */
function closeScope() {
  const targets = recordedTargets();
  const rescans = rescanTargets();
  const handler = scope && scope.handler;
  scope = null;
  if (handler) handler(targets, rescans);
  return targets;
}

/**
 * Run a RESCAN capture: `run()` executes immediately (its reads are what
 * record), every dir it touches is recorded with kind `rescan`, and the
 * recorded target carries `run` itself — so the dev loop re-runs exactly the
 * scan whose input changed. ONE line per capture at the call site: whatever
 * `run` writes into is the live decision the render reads.
 * @param {function} run - the scan, re-runnable at any time
 * @returns {*} run()'s return value
 */
function rescan(run) {
  if (!scope) return run();
  const previous = scope.rescan;
  scope.rescan = run;
  try {
    return run();
  } finally {
    scope.rescan = previous;
  }
}

/**
 * The active scope's recorded RESET union — deduped, contained dirs pruned,
 * one entry per directory. A change to any of them rebuilds the whole Eleventy
 * config.
 * @returns {Array<{ dir: string, kind: string }>}
 */
function recordedTargets() {
  return union('reset').map(({ dir }) => ({ dir, kind: 'reset' }));
}

/**
 * The active scope's recorded RESCAN union — same pruning, each surviving
 * target carrying a `rerun` that re-runs every capture recorded under it
 * (a pruned dir's capture rides the ancestor that swallowed it).
 * @returns {Array<{ dir: string, kind: string, rerun: function }>}
 */
function rescanTargets() {
  return union('rescan').map(({ dir, reruns }) => ({
    dir,
    kind: 'rescan',
    rerun: () => reruns.forEach((run) => run()),
  }));
}

/**
 * The pruned union of one kind: contained dirs fold into their shallowest
 * recorded ancestor, and that ancestor inherits their captures.
 * @param {string} kind
 * @returns {Array<{ dir: string, reruns: Set<function> }>}
 */
function union(kind) {
  if (!scope) return [];
  const dirs = new Set([...scope.dirs].filter(([, entry]) => entry.kind === kind).map(([dir]) => dir));
  const kept = new Map();

  for (const dir of dirs) {
    const cover = covering(dir, dirs);
    const reruns = kept.get(cover) || new Set();
    scope.dirs.get(dir).reruns.forEach((run) => reruns.add(run));
    kept.set(cover, reruns);
  }
  return [...kept].map(([dir, reruns]) => ({ dir, reruns }));
}

/**
 * The SHALLOWEST recorded ancestor of a dir, or the dir itself when nothing
 * recorded contains it.
 * @param {string} dir
 * @param {Set<string>} dirs - the recorded dirs of one kind
 * @returns {string}
 */
function covering(dir, dirs) {
  let cover = dir;
  let parent = path.dirname(dir);
  while (parent !== path.dirname(parent)) {
    if (dirs.has(parent)) cover = parent;
    parent = path.dirname(parent);
  }
  return cover;
}

/**
 * Record a directory into the active scope (no-op outside one). A reset
 * recording is final — the config's own dependency outranks a rescan's.
 * @param {string} dir
 */
function record(dir) {
  if (!scope) return;
  const abs = path.resolve(dir);
  const inConsumer = scope.consumerDir
    && (abs === scope.consumerDir || abs.startsWith(scope.consumerDir + path.sep));
  const key = inConsumer ? abs : resolved(abs);
  const kind = scope.rescan ? 'rescan' : 'reset';
  const entry = scope.dirs.get(key) || { kind, reruns: new Set() };

  if (entry.kind === 'rescan' && kind === 'reset') {
    entry.kind = 'reset';
    entry.reruns.clear();
  }
  if (scope.rescan && entry.kind === 'rescan') entry.reruns.add(scope.rescan);
  scope.dirs.set(key, entry);
}

/**
 * The realpath of a path. A MISSING path has nothing to resolve, but the way
 * to it can still run through a symlink — a linked brand's not-yet-shipped
 * packaged dir is reached through `node_modules/@omega.js/web`, the subtree
 * Eleventy's watcher ignores wholesale — so the nearest EXISTING ancestor is
 * resolved and the missing tail re-joined onto it.
 * @param {string} abs
 * @returns {string}
 */
function resolved(abs) {
  try {
    return fs.realpathSync(abs);
  } catch {
    const parent = path.dirname(abs);
    if (parent === abs) return abs; // the filesystem root: nothing above it to resolve
    return path.join(resolved(parent), path.basename(abs));
  }
}

/**
 * List a directory, recording it. Reading through here is what arms the watch.
 * @param {string} dir
 * @param {object} [options] - fs.readdirSync options (withFileTypes, recursive)
 * @returns {Array} fs.readdirSync's result
 */
function readdir(dir, options) {
  record(dir);
  return fs.readdirSync(dir, options);
}

/**
 * Read a UTF-8 file, recording its directory.
 * @param {string} file
 * @returns {string}
 */
function read(file) {
  record(path.dirname(file));
  return fs.readFileSync(file, 'utf8');
}

/**
 * Does a directory exist? Records it either way — a dir that appears
 * mid-session must already be armed.
 * @param {string} dir
 * @returns {boolean}
 */
function dirExists(dir) {
  record(dir);
  return fs.existsSync(dir);
}

/**
 * Does a file exist? Records the directory that holds it, present or not.
 * @param {string} file
 * @returns {boolean}
 */
function fileExists(file) {
  record(path.dirname(file));
  return fs.existsSync(file);
}

module.exports = {
  onNextScope,
  openScope,
  closeScope,
  rescan,
  recordedTargets,
  rescanTargets,
  readdir,
  read,
  dirExists,
  fileExists,
};
