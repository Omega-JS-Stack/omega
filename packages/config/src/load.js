/**
 * omega.json5 discovery + loading.
 *
 * File locations under a project dir (first match wins):
 *   config/omega.json5             — every project type
 *   functions/config/omega.json5   — standalone backend repos
 *
 * Brand-monorepo hierarchy: when projectDir is an app inside a brand
 * monorepo ({brand}/apps/{app}), the brand root's config/omega.json5 is the
 * brand layer under the app's file. Resolution for a target:
 *
 *   defaults ← brand shared ← brand targets[target] ← app shared ← app targets[target]
 *
 * "shared" = the file minus its `targets` key. A target entry may override
 * ANY shared key — same agnostic deep merge at every step (see merge.js), so
 * a per-surface sentry.dsn or analytics id is just targets.<type>.sentry.dsn.
 * Target-section keys land at the TOP LEVEL of the resolved config
 * (targets.desktop.platforms resolves to config.platforms); the merged
 * `targets` map itself is kept on the result purely so enabled-target
 * enumeration survives resolution — settings are never read from it.
 *
 * Secrets hard-fail: raw files are scanned BEFORE any merge — a secret in
 * any target section (requested or not) throws. Schema findings come back
 * as `errors` so callers pick their strictness (audit throws, boot warns —
 * EM's proven two-mode usage).
 */

const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

const { deepMerge, isPlainObject } = require('./merge.js');
const { findSecretKeys } = require('./secrets.js');
const { validateConfig } = require('./validate.js');
const { TARGETS } = require('./schema.js');

const FILE_NAME = 'omega.json5';
const CONFIG_LOCATIONS = [
  path.join('config', FILE_NAME),
  path.join('functions', 'config', FILE_NAME),
];

/**
 * Resolve the omega.json5 path for a project dir.
 * @param {string} projectDir - The project root (app root in a brand monorepo).
 * @returns {string|null} Absolute path, or null when the project has none.
 */
function resolveConfigPath(projectDir) {
  const hit = CONFIG_LOCATIONS
    .map((relative) => path.join(projectDir, relative))
    .find((absolute) => fs.existsSync(absolute));

  return hit || null;
}

/**
 * Cheap probe: does this project have an omega.json5 at all? Frameworks use it
 * to fail soft in non-consumer dirs (seeded-empty config); tooling uses it as
 * the "is this project migrated yet?" signal.
 * @param {string} projectDir
 * @returns {boolean}
 */
function hasOmegaConfig(projectDir) {
  return resolveConfigPath(projectDir) !== null;
}

function readConfigFile(absolutePath) {
  try {
    return JSON5.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse ${absolutePath}: ${e.message}`);
  }
}

/**
 * {brand}/apps/{app} → the brand root — only counts when the brand root
 * actually carries a config (a plain `apps` folder outside a brand monorepo
 * has none, so the walk-up is a no-op there). The env cascade (env.js) walks
 * the same way — this is the ONE definition of the hierarchy.
 * @param {string} projectDir - The app dir (or its functions/ dir).
 * @returns {string|null} Absolute brand root, or null outside a brand monorepo.
 */
function findBrandRoot(projectDir) {
  let appDir = path.resolve(projectDir);

  // A backend's runtime cwd is its functions/ dir (Cloud Functions and the
  // emulator both boot there) — the app root is one level up. Mirrors the
  // functions/config/omega.json5 entry in CONFIG_LOCATIONS.
  if (path.basename(appDir) === 'functions') {
    appDir = path.dirname(appDir);
  }

  const appsDir = path.dirname(appDir);
  if (path.basename(appsDir) !== 'apps') return null;

  const brandRoot = path.dirname(appsDir);
  return fs.existsSync(path.join(brandRoot, 'config', FILE_NAME)) ? brandRoot : null;
}

function findBrandConfigPath(projectDir) {
  const brandRoot = findBrandRoot(projectDir);
  return brandRoot ? path.join(brandRoot, 'config', FILE_NAME) : null;
}

/**
 * SEARCH upward from any directory to the nearest brand-monorepo root: the
 * first ancestor carrying an omega.json5 that is not itself an APP of a brand
 * above it (app rule = findBrandRoot's: directly under an apps/ dir with a
 * brand-level config/omega.json5 one level above — so a brand living inside
 * some larger workspace's apps/ folder still resolves as a brand root).
 *
 * Complements findBrandRoot, which CLASSIFIES one app dir (app → its brand,
 * else null): resolveBrandRoot works from anywhere in the tree — the brand
 * root itself, apps/{app}, apps/{app}/functions, or any subdirectory — and a
 * standalone config-carrying project resolves to itself.
 *
 * @param {string} startDir - Any directory inside the project tree
 * @returns {string|null} Absolute brand (or standalone-project) root, or null
 *   when no omega.json5 exists anywhere up the tree.
 */
function resolveBrandRoot(startDir) {
  let dir = path.resolve(startDir);

  while (true) {
    // A backend's functions/ dir carries the app's config (functions/config/)
    // but is never a root itself — its app dir one level up is.
    if (path.basename(dir) !== 'functions' && resolveConfigPath(dir)) {
      const grandparent = path.dirname(path.dirname(dir));
      const isAppOfBrand = path.basename(path.dirname(dir)) === 'apps'
        && fs.existsSync(path.join(grandparent, 'config', FILE_NAME));

      if (!isAppOfBrand) {
        return dir;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function stripTargets(config) {
  if (!config) return null;
  const { targets, ...shared } = config;
  return shared;
}

/**
 * Enabled targets of a config (raw or resolved): the keys of its `targets`
 * object — key presence IS the enablement signal.
 * @param {object} config
 * @returns {string[]}
 */
function getEnabledTargets(config) {
  const targets = config ? config.targets : undefined;
  return targets && typeof targets === 'object' ? Object.keys(targets) : [];
}

/**
 * Load + resolve a project's omega.json5.
 * @param {string} projectDir - The project root (app root in a brand monorepo).
 * @param {string} [target] - Canonical target name ('web', 'backend', ...). When
 *   given, the target sections overlay the shared namespace. When omitted, the
 *   brand + app files merge whole (targets map included) — the shape tools like
 *   omega-manager's disperse want.
 * @param {object} [options]
 * @param {object} [options.defaults] - Framework defaults, the lowest merge layer.
 * @returns {{ config: object, errors: string[], enabled: boolean|null, files: { app: string, brand: string|null } }}
 *   `enabled` = whether `target` is listed under `targets` (null when no target
 *   was requested); schema `errors` are returned, not thrown — only secrets and
 *   unusable files throw.
 */
function loadConfig(projectDir, target, options) {
  options = options || {};

  if (target && !TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}" — must be one of [${TARGETS.join(', ')}]`);
  }

  const appPath = resolveConfigPath(projectDir);
  if (!appPath) {
    throw new Error(`No ${FILE_NAME} found under ${projectDir} (looked in ${CONFIG_LOCATIONS.join(', ')}) — probe with hasOmegaConfig() first; legacy configs must be migrated (see docs/config.md)`);
  }

  const brandPath = findBrandConfigPath(projectDir);
  const app = readConfigFile(appPath);
  const brand = brandPath ? readConfigFile(brandPath) : null;

  // ─── Raw-file hard fails: secrets + legacy targets array ────────────────
  [{ file: brandPath, data: brand }, { file: appPath, data: app }].forEach(({ file, data }) => {
    if (!data) return;

    const secrets = findSecretKeys(data);
    if (secrets.length) {
      throw new Error(`Secret-shaped keys in ${file} — secrets live in .env, never in ${FILE_NAME}: ${secrets.join(', ')}`);
    }

    // The legacy brand-config `targets` ARRAY would silently mangle into
    // {0: 'web', ...} through the merge — catch it loudly instead
    if (data.targets !== undefined && !isPlainObject(data.targets)) {
      throw new Error(`targets in ${file} must be an object keyed by target name (key presence = enabled) — the legacy array form is not valid ${FILE_NAME}`);
    }
  });

  // ─── Resolve ─────────────────────────────────────────────────────────────
  const hasTargets = !!((brand && brand.targets) || app.targets);
  const targets = deepMerge(brand ? brand.targets : null, app.targets);

  const config = target
    ? deepMerge(
        options.defaults,
        stripTargets(brand),
        brand && brand.targets ? brand.targets[target] : null,
        stripTargets(app),
        app.targets ? app.targets[target] : null,
      )
    : deepMerge(options.defaults, brand, app);

  // Keep the merged targets map on the resolved config (presence = enabled)
  if (target && hasTargets) {
    config.targets = targets;
  }

  const enabled = target
    ? hasTargets && Object.prototype.hasOwnProperty.call(targets, target)
    : null;

  const { errors } = validateConfig(config, { target });

  return { config, errors, enabled, files: { app: appPath, brand: brandPath } };
}

module.exports = { loadConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets, findBrandRoot, resolveBrandRoot, FILE_NAME, CONFIG_LOCATIONS };
