/**
 * Brand-monorepo loading — resolve the brand root from any cwd inside it,
 * load config/omega.json5 through @omegajs/config (whole-file merge, manager
 * defaults as the lowest layer), enumerate enabled targets, and discover the
 * apps under apps/.
 *
 * This replaces omega-manager's .brands/{id}/config.json + buildBrandConfig()
 * pair: in the brand-monorepo world the brand's own omega.json5 IS the single
 * source of user choices — the manager reads the same file every framework
 * reads, no mirror to disperse.
 *
 * App → target mapping, first match wins:
 *   1. Declared — the app's own omega.json5 (config/ or functions/config/)
 *      lists exactly the target under `targets` (key presence = enabled).
 *   2. Directory convention — apps/website* → web, apps/backend* → backend,
 *      apps/desktop* → desktop, apps/extension* → extension, apps/mobile* → mobile.
 * Unmapped apps surface as workspace-service warnings, never silent skips.
 */

const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

const { loadConfig, resolveConfigPath, getEnabledTargets, deepMerge } = require('@omegajs/config');
const { DEFAULTS, APP_DIR_TARGETS, templateObject } = require('../config.js');

/**
 * Walk up from startDir to the brand-monorepo root: the nearest ancestor with
 * an omega.json5 that is not an APP of a brand above it. "App" uses the exact
 * rule @omegajs/config's brand walk-up uses: directly under an apps/ dir AND
 * a brand-level config/omega.json5 exists one level above that — so a brand
 * that itself lives inside some larger workspace's apps/ folder (the
 * monorepo's sandbox brand) still resolves as a brand root. Works from the
 * brand root, from inside apps/{app}, and from inside apps/{app}/functions.
 *
 * @param {string} startDir - Any directory inside the brand monorepo
 * @returns {string|null} - Absolute brand root, or null when none found
 */
function resolveBrandRoot(startDir) {
  let dir = path.resolve(startDir);

  while (true) {
    // A backend's functions/ dir carries the app's config (functions/config/)
    // but is never a root itself — its app dir one level up is.
    if (path.basename(dir) !== 'functions' && resolveConfigPath(dir)) {
      const grandparent = path.dirname(path.dirname(dir));
      const isAppOfBrand = path.basename(path.dirname(dir)) === 'apps'
        && fs.existsSync(path.join(grandparent, 'config', 'omega.json5'));

      if (!isAppOfBrand) {
        return dir;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Read an app's raw omega.json5 (no merge, no validation) purely to see which
 * targets it declares. Discovery must never throw — validation is the
 * workspace service's job.
 */
function readDeclaredTargets(appPath) {
  const configPath = resolveConfigPath(appPath);
  if (!configPath) return null;

  try {
    const raw = JSON5.parse(fs.readFileSync(configPath, 'utf8'));
    const targets = getEnabledTargets(raw);
    return targets.length > 0 ? targets : null;
  } catch {
    return null;
  }
}

/**
 * Map an app directory name to a target via the naming convention:
 * exact match or `<name>-*` prefix (apps/website-docs → web).
 */
function targetFromDirName(dirName) {
  for (const [prefix, target] of Object.entries(APP_DIR_TARGETS)) {
    if (dirName === prefix || dirName.startsWith(`${prefix}-`)) {
      return target;
    }
  }
  return null;
}

/**
 * Discover the apps under {brandRoot}/apps.
 *
 * @param {string} brandRoot - Absolute brand-monorepo root
 * @returns {Array<{ name, dir, path, target, declaredTargets }>} - One entry
 *   per app directory; `target` is null when unmapped (workspace warns).
 */
function discoverApps(brandRoot) {
  const appsDir = path.join(brandRoot, 'apps');
  if (!fs.existsSync(appsDir)) return [];

  const apps = [];

  for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const appPath = path.join(appsDir, entry.name);
    const declaredTargets = readDeclaredTargets(appPath);

    // Declared target wins; a single declaration is unambiguous, multiple
    // declarations fall back to the directory convention as the tiebreaker.
    let target = null;
    if (declaredTargets && declaredTargets.length === 1) {
      target = declaredTargets[0];
    } else {
      target = targetFromDirName(entry.name);
      if (!target && declaredTargets) target = declaredTargets[0];
    }

    apps.push({
      name: entry.name,
      dir: `apps/${entry.name}`,
      path: appPath,
      target,
      declaredTargets,
    });
  }

  return apps;
}

/**
 * Load a brand monorepo: config (defaults ← [company ←] brand file,
 * whole-file merge with `{ domain }` templating applied), enabled targets,
 * discovered apps. `companyConfig` is the inheritable layer from a company
 * workspace (its omega.json5 minus the `brands` key) — runManage resolves it
 * from the brand's `.omega/company.json` stamp.
 *
 * Config load failures (parse error, secret-shaped keys, legacy targets
 * array) do NOT throw here — they land in `configError` so the workspace
 * service reports them through the normal status flow.
 *
 * @param {string} brandRoot - Absolute brand-monorepo root
 * @param {Object} [options] - { companyConfig? }
 * @returns {{ root, id, config, configError, configErrors, targets, apps, files }}
 */
function loadBrand(brandRoot, { companyConfig = null } = {}) {
  let loaded = null;
  let configError = null;

  // deepMerge skips falsy layers, so a standalone brand passes straight through
  const defaults = deepMerge(DEFAULTS, companyConfig);

  try {
    loaded = loadConfig(brandRoot, undefined, { defaults });
  } catch (error) {
    configError = error.message;
  }

  let config = loaded ? loaded.config : { ...defaults, brand: { id: path.basename(brandRoot) } };

  // Template `{ domain }` placeholders from brand.url (omega-manager parity)
  const url = config.brand?.url || '';
  const domain = url.replace(/^https?:\/\//, '');
  if (domain) {
    config = templateObject(config, {
      domain,
      domainDashed: domain.replace(/\./g, '-'),
    });
  }

  return {
    root: brandRoot,
    id: config.brand?.id || path.basename(brandRoot),
    config,
    configError,
    configErrors: loaded ? loaded.errors : [],
    targets: loaded ? getEnabledTargets(loaded.config) : [],
    apps: discoverApps(brandRoot),
    files: loaded ? loaded.files : null,
  };
}

module.exports = { resolveBrandRoot, loadBrand, discoverApps, targetFromDirName };
