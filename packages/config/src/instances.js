/**
 * Multi-instance targets — the normalization trick and the target-dir mapping
 * (_attic/plans/multi-instance-targets.md, shape ratified by Ian 2026-07-20).
 *
 * `targets.<type>` may be an object (today's single-instance shape) or an
 * ARRAY of id'd instance entries. Normalization is the whole mechanism: a
 * single object normalizes to `[{ id: 'main', ...entry }]` internally, so
 * every consumer of target config iterates instances and the single-instance
 * world is just length 1 — zero breaking change for existing brands.
 *
 * Target-dir mapping: the `main` instance (or the single-object form) lives in
 * `targets/<canonical dir>` (targets/website, unchanged); any other id lives in
 * `targets/<canonical dir>-<id>` (targets/website-admin). The inverse walk resolves
 * WHICH instance a target dir is, and loadConfig/composeTargetConfig use it to
 * pick the instance entry as the target layer of the merge chain.
 *
 * This module is the ONE home for the instance iteration mechanism (mirrored-
 * implementation rule) — frameworks and the manager import it, never copy it.
 * The canonical dir names moved here from the manager's config.js so the
 * mapping and its inverse walk share a single SSOT.
 */

const path = require('node:path');

const { isPlainObject } = require('./merge.js');

// targets/<dir> → target mapping when the target dir doesn't declare its target
// in its own omega.json5. Exact match or `<name>-<id>` suffix (targets/website-admin →
// web, instance admin). Moved here from @omega.js/manager's config.js (which
// re-exports it) so the target-dir walk has one home.
const DIR_TARGETS = {
  website: 'web',
  backend: 'backend',
  desktop: 'desktop',
  extension: 'extension',
  mobile: 'mobile',
};

// Inverse: canonical target dir per target (targets/website for web, …)
const TARGET_DIRS = Object.fromEntries(
  Object.entries(DIR_TARGETS).map(([dir, target]) => [target, dir]),
);

// The conventional primary instance id — the single-object form normalizes
// to it, and it maps to the canonical (un-suffixed) target dir.
const MAIN_INSTANCE = 'main';

// Instance ids are target-dir suffixes, so they must be dir-safe slugs
const INSTANCE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Normalize a `targets.<type>` entry to the instances array. The whole trick:
 * a single object becomes `[{ id: 'main', ...entry }]` (an authored `id`
 * inside the object wins); an array passes through as-is — the validator, not
 * this function, enforces that array entries carry ids.
 * @param {object|Array|null|undefined} entry - The raw targets.<type> value.
 * @returns {Array<object>} Instance entries (shallow copies); [] when absent.
 */
function normalizeTargetInstances(entry) {
  if (entry === undefined || entry === null) return [];
  if (Array.isArray(entry)) return entry.map((instance) => (isPlainObject(instance) ? { ...instance } : instance));
  return [{ id: MAIN_INSTANCE, ...entry }];
}

/**
 * Target dir name → instance id for a target. The inverse walk of the mapping:
 * the canonical dir (targets/website) is `main`; a `<canonical>-<id>` suffix
 * names the instance (targets/website-admin → admin). Unconventional dir names
 * resolve to `main` — today's behavior for dirs like targets/api.
 * @param {string} dirName - The target directory basename.
 * @param {string} target - Canonical target name ('web', 'backend', ...).
 * @returns {string} The instance id.
 */
function instanceIdFromDirName(dirName, target) {
  const canonical = TARGET_DIRS[target] || target;
  if (dirName.startsWith(`${canonical}-`)) {
    return dirName.slice(canonical.length + 1);
  }
  return MAIN_INSTANCE;
}

/**
 * Instance id → its target dir name (`main` → the canonical dir, anything else
 * → `<canonical>-<id>`).
 * @param {string} target - Canonical target name.
 * @param {string} id - Instance id.
 * @returns {string} The target directory basename.
 */
function instanceTargetDir(target, id) {
  const canonical = TARGET_DIRS[target] || target;
  return id === MAIN_INSTANCE ? canonical : `${canonical}-${id}`;
}

/**
 * Resolve THIS project dir's instance id for a target: TARGET_SUBDIR dirs
 * (functions/, dist/) normalize up to their target root, and only targets inside a
 * brand monorepo resolve through the dir-name walk — a standalone project
 * (whose dir name is arbitrary) is always `main`.
 * @param {string} projectDir - Target root (or one of its TARGET_SUBDIRS).
 * @param {string} target - Canonical target name.
 * @returns {string} The instance id.
 */
function targetInstance(projectDir, target) {
  // Local require to avoid a load-time cycle (load.js requires this module)
  const { findBrandRoot, TARGET_SUBDIRS } = require('./load.js');

  let targetRoot = path.resolve(projectDir);
  if (TARGET_SUBDIRS.includes(path.basename(targetRoot))) {
    targetRoot = path.dirname(targetRoot);
  }

  if (!findBrandRoot(targetRoot)) return MAIN_INSTANCE;
  return instanceIdFromDirName(path.basename(targetRoot), target);
}

/**
 * The merge-chain layer for one instance: the single-object form applies to
 * EVERY target dir of the type (today's semantics, unchanged); the array form
 * applies only to the exact-id match — no match means no instance layer
 * (shared config alone). The `id` key is bookkeeping, never config — it is
 * stripped from the returned entry.
 * @param {object|Array|null|undefined} entry - The raw targets.<type> value.
 * @param {string} instanceId - The instance to resolve.
 * @returns {object|null} The instance's merge layer, or null.
 */
function resolveInstanceEntry(entry, instanceId) {
  if (entry === undefined || entry === null) return null;
  if (!Array.isArray(entry)) return entry;

  const hit = entry.find((instance) => isPlainObject(instance) && instance.id === instanceId);
  if (!hit) return null;

  const { id, ...rest } = hit;
  return rest;
}

/**
 * Deterministic dev-port offset for an instance: its position in the
 * normalized instances array (main-or-object form = 0), so N instances get N
 * side-by-side ports off the same classic base. Unknown ids offset 0 — the
 * N7 bump-if-taken allocator still guarantees a free port.
 * @param {object|Array|null|undefined} entry - The raw targets.<type> value.
 * @param {string} instanceId - The instance id.
 * @returns {number} Zero-based offset.
 */
function instancePortOffset(entry, instanceId) {
  const index = normalizeTargetInstances(entry).findIndex((instance) => isPlainObject(instance) && instance.id === instanceId);
  return index > 0 ? index : 0;
}

/**
 * The live URL of an instance: its entry's `url` (the spec's per-instance
 * key), an instance-scoped `brand.url` override, then the brand-shared
 * brand.url — the manager's per-instance live checks read this.
 * @param {object|Array|null|undefined} entry - The raw targets.<type> value.
 * @param {string} instanceId - The instance id.
 * @param {object} config - The (resolved) config carrying brand.url.
 * @returns {string|null} The instance's URL, or null when none is known.
 */
function resolveInstanceUrl(entry, instanceId, config) {
  const instance = resolveInstanceEntry(entry, instanceId);
  return instance?.url || instance?.brand?.url || config?.brand?.url || null;
}

module.exports = {
  DIR_TARGETS,
  TARGET_DIRS,
  MAIN_INSTANCE,
  INSTANCE_ID_PATTERN,
  normalizeTargetInstances,
  instanceIdFromDirName,
  instanceTargetDir,
  targetInstance,
  resolveInstanceEntry,
  instancePortOffset,
  resolveInstanceUrl,
};
