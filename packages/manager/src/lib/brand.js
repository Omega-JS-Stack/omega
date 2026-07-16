/**
 * Brand-monorepo loading — resolve the brand root from any cwd inside it,
 * load config/omega.json5 through @omega.js/config (whole-file merge, manager
 * defaults as the lowest layer), enumerate enabled targets, and discover the
 * apps under apps/.
 *
 * This replaces omega-manager's .brands/{id}/config.json + buildBrandConfig()
 * pair: in the brand-monorepo world the brand's own omega.json5 IS the single
 * source of user choices — the manager reads the same file every framework
 * reads, no mirror to disperse.
 *
 * App → target mapping, first match wins:
 *   1. Declared — the app's own config/omega.json5 lists exactly the target
 *      under `targets` (key presence = enabled).
 *   2. Directory convention — apps/website* → web, apps/backend* → backend,
 *      apps/desktop* → desktop, apps/extension* → extension, apps/mobile* → mobile.
 * Unmapped apps surface as workspace-service warnings, never silent skips.
 */

const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

// resolveBrandRoot moved into @omega.js/config (cp73c) — the hierarchy walk
// has ONE home there, alongside findBrandRoot and the env cascade.
const { loadConfig, resolveConfigPath, getEnabledTargets, deepMerge, resolveBrandRoot } = require('@omega.js/config');
const { DEFAULTS, APP_DIR_TARGETS, templateObject } = require('../config.js');

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

/**
 * Resolve a brand image (brand.images.<key>) to an ABSOLUTE URL for external
 * services (Stripe product images, Chatsy avatars, …). Config stores
 * site-relative paths (served by the web build's static channel — the site
 * itself absolutizes per environment); external surfaces can't resolve a
 * relative path, so join against brand.url. Full URLs pass through.
 * @param {object} brandConfig - merged brand config
 * @param {string} key - images key ('brandmark' | 'social' | ...)
 * @returns {string|null} absolute URL, or null when unresolvable
 */
function absoluteBrandImage(brandConfig, key) {
  const value = brandConfig?.brand?.images?.[key] || null;
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;

  const base = String(brandConfig?.brand?.url || '').replace(/\/$/, '');
  return base ? `${base}${value.startsWith('/') ? '' : '/'}${value}` : null;
}

module.exports = { resolveBrandRoot, loadBrand, discoverApps, targetFromDirName, absoluteBrandImage };
