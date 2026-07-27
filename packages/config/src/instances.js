/**
 * Multi-instance targets — the normalization trick and the app-dir mapping
 * (_attic/plans/multi-instance-targets.md, shape ratified by Ian 2026-07-20).
 *
 * `targets.<type>` may be an object (today's single-instance shape) or an
 * ARRAY of id'd instance entries. Normalization is the whole mechanism: a
 * single object normalizes to `[{ id: 'main', ...entry }]` internally, so
 * every consumer of target config iterates instances and the single-instance
 * world is just length 1 — zero breaking change for existing brands.
 *
 * App-dir mapping: the `main` instance (or the single-object form) lives in
 * `apps/<canonical dir>` (apps/website, unchanged); any other id lives in
 * `apps/<canonical dir>-<id>` (apps/website-admin). The inverse walk resolves
 * WHICH instance an app dir is, and loadConfig/composeTargetConfig use it to
 * pick the instance entry as the target layer of the merge chain.
 *
 * This module is the ONE home for the instance iteration mechanism (mirrored-
 * implementation rule) — frameworks and the manager import it, never copy it.
 * The canonical dir names moved here from the manager's config.js so the
 * mapping and its inverse walk share a single SSOT.
 */

const path = require('node:path');

const { isPlainObject } = require('./merge.js');

// apps/<dir> → target mapping when the app doesn't declare its target in its
// own omega.json5. Exact match or `<name>-<id>` suffix (apps/website-admin →
// web, instance admin). Moved here from @omega.js/manager's config.js (which
// re-exports it) so the app-dir walk has one home.
const APP_DIR_TARGETS = {
  website: 'web',
  backend: 'backend',
  desktop: 'desktop',
  extension: 'extension',
  mobile: 'mobile',
};

// Inverse: canonical app dir per target (apps/website for web, …)
const TARGET_APP_DIRS = Object.fromEntries(
  Object.entries(APP_DIR_TARGETS).map(([dir, target]) => [target, dir]),
);

// The conventional primary instance id — the single-object form normalizes
// to it, and it maps to the canonical (un-suffixed) app dir.
const MAIN_INSTANCE = 'main';

// Instance ids are app-dir suffixes, so they must be dir-safe slugs
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
 * App dir name → instance id for a target. The inverse walk of the mapping:
 * the canonical dir (apps/website) is `main`; a `<canonical>-<id>` suffix
 * names the instance (apps/website-admin → admin). Unconventional dir names
 * resolve to `main` — today's behavior for dirs like apps/api.
 * @param {string} dirName - The app directory basename.
 * @param {string} target - Canonical target name ('web', 'backend', ...).
 * @returns {string} The instance id.
 */
function instanceIdFromDirName(dirName, target) {
  const canonical = TARGET_APP_DIRS[target] || target;
  if (dirName.startsWith(`${canonical}-`)) {
    return dirName.slice(canonical.length + 1);
  }
  return MAIN_INSTANCE;
}

/**
 * Instance id → its app dir name (`main` → the canonical dir, anything else
 * → `<canonical>-<id>`).
 * @param {string} target - Canonical target name.
 * @param {string} id - Instance id.
 * @returns {string} The app directory basename.
 */
function instanceAppDir(target, id) {
  const canonical = TARGET_APP_DIRS[target] || target;
  return id === MAIN_INSTANCE ? canonical : `${canonical}-${id}`;
}

/**
 * Resolve THIS project dir's instance id for a target: functions/ dirs
 * normalize up to their app root, and only apps inside a brand monorepo
 * resolve through the dir-name walk — a standalone project (whose dir name
 * is arbitrary) is always `main`.
 * @param {string} projectDir - App root (or its functions/ dir).
 * @param {string} target - Canonical target name.
 * @returns {string} The instance id.
 */
function appInstance(projectDir, target) {
  // Local require to avoid a load-time cycle (load.js requires this module)
  const { findBrandRoot } = require('./load.js');

  let appRoot = path.resolve(projectDir);
  if (path.basename(appRoot) === 'functions') {
    appRoot = path.dirname(appRoot);
  }

  if (!findBrandRoot(appRoot)) return MAIN_INSTANCE;
  return instanceIdFromDirName(path.basename(appRoot), target);
}

/**
 * The merge-chain layer for one instance: the single-object form applies to
 * EVERY app of the type (today's semantics, unchanged); the array form
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
  APP_DIR_TARGETS,
  TARGET_APP_DIRS,
  MAIN_INSTANCE,
  INSTANCE_ID_PATTERN,
  normalizeTargetInstances,
  instanceIdFromDirName,
  instanceAppDir,
  appInstance,
  resolveInstanceEntry,
  instancePortOffset,
  resolveInstanceUrl,
};
