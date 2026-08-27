/**
 * Brand-monorepo loading — resolve the brand root from any cwd inside it,
 * load config/omega.json5 through @omega.js/config (whole-file merge, manager
 * defaults as the lowest layer), enumerate enabled targets, and discover the
 * target dirs under targets/.
 *
 * This replaces omega-manager's .brands/{id}/config.json + buildBrandConfig()
 * pair: in the brand-monorepo world the brand's own omega.json5 IS the single
 * source of user choices — the manager reads the same file every framework
 * reads, no mirror to disperse.
 *
 * Target dir → target mapping, first match wins:
 *   1. Declared — the dir's own config/omega.json5 lists exactly the target
 *      under `targets` (key presence = enabled).
 *   2. Directory convention — targets/website* → web, targets/backend* → backend,
 *      targets/desktop* → desktop, targets/extension* → extension, targets/mobile* → mobile.
 * Unmapped dirs surface as workspace-service warnings, never silent skips.
 *
 * A CUSTOM target (#603) is neither: the brand config declares it
 * (`targets.<name>: { type: 'custom' }`) and its dir carries no framework. It
 * is marked `custom: true` with `target` left NULL, which is what makes every
 * framework service's `filter((entry) => entry.target)` skip it for free —
 * only the two ops that must see it (env disperse, the workspace service)
 * read the flag.
 *
 * A backend entry also carries `projectType` (#584) — 'firebase' (Cloud
 * Functions) or 'custom' (the same backend as its own server on a container
 * host). That is a framework target either way; the mode only decides which
 * verbs its framework can serve (framework-bin.js).
 */

const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

// resolveBrandRoot moved into @omega.js/config (cp73c) — the hierarchy walk
// has ONE home there, alongside findBrandRoot and the env cascade.
const { loadConfig, resolveConfigPath, getEnabledTargets, resolveBrandRoot, backendProjectType, normalizeTargetInstances } = require('@omega.js/config');
const { DEFAULTS, DIR_TARGETS, templateObject } = require('../config.js');
const { customTargetDirs } = require('./custom-target.js');

/**
 * Read a target's raw omega.json5 (no merge, no validation) purely to see which
 * targets it declares. Discovery must never throw — validation is the
 * workspace service's job.
 */
function readDeclaredTargets(targetPath) {
  const configPath = resolveConfigPath(targetPath);
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
 * Map a target directory name to a target via the naming convention:
 * exact match or `<name>-*` prefix (targets/website-docs → web).
 */
function targetFromDirName(dirName) {
  for (const [prefix, target] of Object.entries(DIR_TARGETS)) {
    if (dirName === prefix || dirName.startsWith(`${prefix}-`)) {
      return target;
    }
  }
  return null;
}

/**
 * Discover the targets under {brandRoot}/targets.
 *
 * A brand still carrying `apps/` fails LOUDLY here (#443): the old shape is
 * not a brand with zero targets, it is a brand that never ran the one-time
 * rename, and walking it as empty would quietly do the wrong thing in every
 * service downstream. The fix is a migration, run once, by hand — nothing
 * heals it inside a run.
 *
 * @param {string} brandRoot - Absolute brand-monorepo root
 * @returns {Array<{ name, dir, path, target, projectType, declaredTargets }>} -
 *   One entry per target directory; `target` is null when unmapped (workspace
 *   warns), and `projectType` rides the backend entry only (#584).
 * @throws {Error} when the brand is still on the pre-#443 `apps/` shape
 */
function discoverTargets(brandRoot) {
  // The brand file's own raw view — read here (never through loadBrand, which
  // calls US) purely to learn which dirs are declared custom. Discovery must
  // never throw: an unreadable brand file simply declares no custom targets,
  // and the workspace service reports the real problem.
  let customDirs = new Set();
  // How the backend RUNS (#584) — 'firebase' (Cloud Functions) or 'custom'
  // (its own server on a container host). Read from the same raw view, since
  // it steers which verbs the fan-outs may dispatch at that target.
  let backendMode = 'firebase';
  try {
    const brandConfigPath = resolveConfigPath(brandRoot);
    if (brandConfigPath) {
      const raw = JSON5.parse(fs.readFileSync(brandConfigPath, 'utf8'));
      customDirs = new Set(customTargetDirs(raw));
      backendMode = backendProjectType(normalizeTargetInstances(raw.targets?.backend)[0]);
    }
  } catch {
    // Unreadable brand config — no custom declarations to honor
  }

  const targetsDir = path.join(brandRoot, 'targets');
  if (!fs.existsSync(targetsDir)) {
    if (fs.existsSync(path.join(brandRoot, 'apps'))) {
      throw new Error(
        `${brandRoot} still carries apps/ instead of targets/ (#443) — `
        + 'run `npx omega manage --migration=targets-rename --execute` once, then `npm install`.',
      );
    }

    return [];
  }

  const targets = [];

  for (const entry of fs.readdirSync(targetsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const targetPath = path.join(targetsDir, entry.name);

    // A custom target (#603) has no framework to map to — the brand's own
    // declaration is the whole mapping, and `target` stays null on purpose
    if (customDirs.has(entry.name)) {
      targets.push({
        name: entry.name,
        dir: `targets/${entry.name}`,
        path: targetPath,
        target: null,
        custom: true,
        declaredTargets: null,
      });
      continue;
    }

    const declaredTargets = readDeclaredTargets(targetPath);

    // Declared target wins; a single declaration is unambiguous, multiple
    // declarations fall back to the directory convention as the tiebreaker.
    let target = null;
    if (declaredTargets && declaredTargets.length === 1) {
      target = declaredTargets[0];
    } else {
      target = targetFromDirName(entry.name);
      if (!target && declaredTargets) target = declaredTargets[0];
    }

    targets.push({
      name: entry.name,
      dir: `targets/${entry.name}`,
      path: targetPath,
      target,
      // Backend only: the mode decides which verbs its framework can serve
      // (#584). Every other target has one shape, so it carries no key.
      ...(target === 'backend' ? { projectType: backendMode } : {}),
      declaredTargets,
    });
  }

  return targets;
}

/**
 * Load a brand monorepo: config (manager defaults ← [company ←] brand file,
 * whole-file merge with `{ domain }` templating applied), enabled targets,
 * discovered target dirs.
 *
 * The COMPANY layer is @omega.js/config's, not ours (#83): loadConfig reads
 * the brand's `.omega/company.json` stamp itself and folds the company file
 * (minus `brands`) between the defaults and the brand file. The manager keeps
 * the company config only as PROVENANCE — runManage hangs it on the loaded
 * brand as `companyRoot`/`companyConfig` for services that ask "did this come
 * from the company?" — never as a second fold.
 *
 * Config load failures (parse error, secret-shaped keys, legacy targets
 * array) do NOT throw here — they land in `configError` so the workspace
 * service reports them through the normal status flow.
 *
 * @param {string} brandRoot - Absolute brand-monorepo root
 * @returns {{ root, id, config, configError, configErrors, enabledTargets, targets, files }}
 */
function loadBrand(brandRoot) {
  let loaded = null;
  let configError = null;

  try {
    loaded = loadConfig(brandRoot, undefined, { defaults: DEFAULTS });
  } catch (error) {
    configError = error.message;
  }

  let config = loaded ? loaded.config : { ...DEFAULTS, brand: { id: path.basename(brandRoot) } };

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
    enabledTargets: loaded ? getEnabledTargets(loaded.config) : [],
    targets: discoverTargets(brandRoot),
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

module.exports = { resolveBrandRoot, loadBrand, discoverTargets, targetFromDirName, absoluteBrandImage };
