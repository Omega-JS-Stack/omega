/**
 * omega.json5 discovery + loading.
 *
 * ONE authored location per project dir: config/omega.json5. A deployed
 * backend still resolves its staged functions/config/omega.json5 naturally —
 * the runtime's projectDir IS the functions dir (its cwd), so the staged file
 * is that dir's own config/omega.json5. The old second probe location
 * (functions/config under the TARGET root) died with the src/dist pillar: the
 * staged compose output must never read back as an authored local layer, or a
 * brand edit goes stale behind the previous stage.
 *
 * Brand-monorepo hierarchy: when projectDir is a target inside a brand
 * monorepo ({brand}/targets/{target}), the brand root's config/omega.json5 is the
 * brand layer under the target's file, and a brand stamped with
 * .omega/company.json inherits its company root's file underneath that.
 * Resolution for a target:
 *
 *   schema defaults ← framework defaults ← company ← brand shared ← brand targets[target] ← local shared ← local targets[target]
 *
 * The bottom layer derives from the schema's own `default:` entries
 * ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)) — the one home
 * of every default. `options.defaults` sits above it for the cases where a
 * framework genuinely differs.
 *
 * The company file layers exactly like the brand file (shared, then its
 * targets[target] entry) minus its `brands` key — company plumbing that means
 * nothing inside a brand.
 *
 * Multi-instance targets: a targets[target] value may be an ARRAY of id'd
 * instance entries — the target dir names WHICH instance (targets/website-admin →
 * web/admin, canonical dir → main) and that instance's entry is the target
 * layer for this target (see instances.js; the single-object form applies to
 * every target of the type, unchanged).
 *
 * "shared" = the file minus its `targets` key. A target entry may override
 * ANY shared key — same agnostic deep merge at every step (see merge.js), so
 * a per-surface Sentry DSN or analytics id is just
 * targets.<type>.monitoring.providers.sentry.dsn.
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
const { readCompanyRoot } = require('./company.js');
const { findSecretKeys } = require('./secrets.js');
const { validateConfig } = require('./validate.js');
const { TARGETS } = require('./schema.js');
const { schemaDefaults } = require('./defaults.js');
const { resolveInstanceEntry, resolveInstanceUrl, instanceIdFromDirName, MAIN_INSTANCE } = require('./instances.js');

const FILE_NAME = 'omega.json5';
const CONFIG_LOCATIONS = [
  path.join('config', FILE_NAME),
];

// Dirs a caller can resolve FROM that are one level below the target root: a
// backend's runtime cwd (functions/) and its staged build output (dist/, where
// `omega test` runs). Both normalize up before the brand walk.
const TARGET_SUBDIRS = ['functions', 'dist'];

/**
 * Resolve the omega.json5 path for a project dir.
 * @param {string} projectDir - The project root (target root in a brand monorepo).
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
 * the "is this project migrated yet?" signal. Brand-aware like loadConfig:
 * a target inside a brand monorepo has a config even when its OPTIONAL
 * local-layer file is absent (the brand file is the config) — a target-dir-only
 * probe made every framework gate fail soft with an EMPTY config there
 * (desktop audit hard-failed loud; the extension build silently baked a
 * bundle with no brand config — the cp142 rehearsal catch).
 * @param {string} projectDir
 * @returns {boolean}
 */
function hasOmegaConfig(projectDir) {
  if (resolveConfigPath(projectDir) !== null || findBrandConfigPath(projectDir) !== null) {
    return true;
  }

  // Mirror loadConfig's TARGET_SUBDIR → target-root fallback so probe and load
  // always agree — a probe-false/load-success split makes framework gates
  // proceed with an empty config (the cp142-class failure this probe exists
  // to prevent).
  return TARGET_SUBDIRS.includes(path.basename(path.resolve(projectDir)))
    && resolveConfigPath(path.dirname(path.resolve(projectDir))) !== null;
}

function readConfigFile(absolutePath) {
  try {
    return JSON5.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse ${absolutePath}: ${e.message}`);
  }
}

/**
 * {brand}/targets/{target} → the brand root — only counts when the brand root
 * actually carries a config (a plain `targets` folder outside a brand monorepo
 * has none, so the walk-up is a no-op there). The env cascade (env.js) walks
 * the same way — this is the ONE definition of the hierarchy.
 * @param {string} projectDir - The target dir (or one of its TARGET_SUBDIRS: functions/, dist/).
 * @returns {string|null} Absolute brand root, or null outside a brand monorepo.
 */
function findBrandRoot(projectDir) {
  let targetDir = path.resolve(projectDir);

  // A backend's runtime cwd is its functions/ dir (Cloud Functions and the
  // emulator both boot there), and `omega test` resolves from the staged
  // dist/ — the target root is one level up from either. Mirrors the
  // functions/config/omega.json5 entry in CONFIG_LOCATIONS. Without dist/
  // here the walk looked for targets/ one level too low, so a brand-root .env
  // never joined the cascade
  // ([#257](https://github.com/Omega-JS-Stack/omega/issues/257)).
  if (TARGET_SUBDIRS.includes(path.basename(targetDir))) {
    targetDir = path.dirname(targetDir);
  }

  const targetsDir = path.dirname(targetDir);
  if (path.basename(targetsDir) !== 'targets') return null;

  const brandRoot = path.dirname(targetsDir);
  return fs.existsSync(path.join(brandRoot, 'config', FILE_NAME)) ? brandRoot : null;
}

/**
 * The BRAND layer's omega.json5 for a project dir — the file a target inside a
 * brand monorepo rides when it has no local-layer file of its own.
 * @param {string} projectDir - Target dir, brand root, or a TARGET_SUBDIR of one (functions/, dist/).
 * @returns {string|null} Absolute brand omega.json5 path, or null outside a brand.
 */
function findBrandConfigPath(projectDir) {
  const brandRoot = findBrandRoot(projectDir);
  return brandRoot ? path.join(brandRoot, 'config', FILE_NAME) : null;
}

/**
 * The COMPANY layer of the chain: a brand stamped with `.omega/company.json`
 * (written idempotently by company manage runs) inherits its company root's
 * omega.json5 as the layer between framework defaults and the brand file —
 * company-wide values (a shared monitoring org, an analytics account) are
 * authored once at the company root. The marker sits at the BRAND root, so
 * targets resolve it through their brand; a brand root (or standalone project)
 * reads its own. Same rule as the .env cascade (env.js).
 * @param {string} projectDir - Target dir, brand root, or a TARGET_SUBDIR of one (functions/, dist/).
 * @returns {string|null} Absolute company omega.json5 path, or null.
 */
function findCompanyConfigPath(projectDir) {
  let dir = path.resolve(projectDir);
  // Same normalization as findBrandRoot: a marker is stamped at the target/brand
  // root, never inside the runtime cwd or the staged build output. Reading
  // only `functions/` left a STANDALONE project resolving from dist/ (the view
  // `omega test` loads) looking for the marker inside dist/, so its company
  // layer vanished ([#257](https://github.com/Omega-JS-Stack/omega/issues/257)).
  if (TARGET_SUBDIRS.includes(path.basename(dir))) dir = path.dirname(dir);

  const markerRoot = findBrandRoot(dir) || dir;
  const companyRoot = readCompanyRoot(markerRoot);

  // A root stamped at ITSELF would merge its own file in twice.
  if (!companyRoot || path.resolve(companyRoot) === markerRoot) return null;

  return resolveConfigPath(companyRoot);
}

/**
 * The inheritable company layer: the company file minus `brands` — the
 * discovery roots are company plumbing and mean nothing inside a brand.
 */
function stripCompanyPlumbing(config) {
  if (!config) return null;
  const { brands, ...inheritable } = config;
  return inheritable;
}

/**
 * SEARCH upward from any directory to the nearest brand-monorepo root: the
 * first ancestor carrying an omega.json5 that is not itself a TARGET of a brand
 * above it (target rule = findBrandRoot's: directly under a targets/ dir with a
 * brand-level config/omega.json5 one level above — so a brand living inside
 * some larger workspace's targets/ folder still resolves as a brand root).
 *
 * Complements findBrandRoot, which CLASSIFIES one target dir (target → its brand,
 * else null): resolveBrandRoot works from anywhere in the tree — the brand
 * root itself, targets/{target}, targets/{target}/functions, or any subdirectory — and a
 * standalone config-carrying project resolves to itself.
 *
 * The walk is BOUNDED at the nearest `.git` (that directory is still checked
 * first — a brand root is normally its own git root): past the repo boundary
 * is somebody else's tree, never this project's brand. The plugin's inject
 * hook bounds its identical walk the same way.
 *
 * @param {string} startDir - Any directory inside the project tree
 * @returns {string|null} Absolute brand (or standalone-project) root, or null
 *   when no omega.json5 exists anywhere up the tree.
 */
function resolveBrandRoot(startDir) {
  let dir = path.resolve(startDir);

  while (true) {
    // A backend's functions/ dir carries the target's config (functions/config/)
    // but is never a root itself — its target dir one level up is. Its staged
    // dist/ carries the same compose output and is no more a root than
    // functions/ is ([#299](https://github.com/Omega-JS-Stack/omega/issues/299)).
    if (!TARGET_SUBDIRS.includes(path.basename(dir)) && resolveConfigPath(dir)) {
      const grandparent = path.dirname(path.dirname(dir));
      // `apps` here is DETECTION, not compatibility: a pre-#443 brand must
      // resolve to its TRUE root so discovery fails loud with the
      // targets-rename pointer. Stopping at a config-carrying target dir
      // would instead load that target AS the brand — and let the migration
      // itself no-op when run from inside one.
      const parentName = path.basename(path.dirname(dir));
      const isTargetOfBrand = (parentName === 'targets' || parentName === 'apps')
        && fs.existsSync(path.join(grandparent, 'config', FILE_NAME));

      if (!isTargetOfBrand) {
        return dir;
      }
    }

    // Repo boundary — stop here rather than statting out through the host
    // filesystem to /.
    if (fs.existsSync(path.join(dir, '.git'))) return null;

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
 * Raw-file hard fails, applied BEFORE any merge: secrets anywhere in the
 * file (requested target or not) and the legacy targets ARRAY (it would
 * silently mangle into {0: 'web', …} through the merge).
 */
function assertUsableRawFile(file, data) {
  if (!data) return;

  const secrets = findSecretKeys(data);
  if (secrets.length) {
    throw new Error(`Secret-shaped keys in ${file} — secrets live in .env, never in ${FILE_NAME}: ${secrets.join(', ')}`);
  }

  if (data.targets !== undefined && !isPlainObject(data.targets)) {
    throw new Error(`targets in ${file} must be an object keyed by target name (key presence = enabled) — the legacy array form is not valid ${FILE_NAME}`);
  }
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
 * @param {string} projectDir - The project root (target root in a brand monorepo).
 * @param {string} [target] - Canonical target name ('web', 'backend', ...). When
 *   given, the target sections overlay the shared namespace. When omitted, the
 *   brand + local files merge whole (targets map included) — the shape tools like
 *   omega-manager's disperse want.
 * @param {object} [options]
 * @param {object} [options.defaults] - Framework defaults, layered directly on
 *   top of the schema defaults (#478) — only what this framework does differently.
 * @returns {{ config: object, errors: string[], warnings: string[], enabled: boolean|null, instance: string, files: { local: string, brand: string|null, company: string|null } }}
 *   `enabled` = whether `target` is listed under `targets` (null when no target
 *   was requested); schema `errors` are returned, not thrown — only secrets and
 *   unusable files throw. `warnings` are advisory findings (e.g. >1 backend
 *   instance); `instance` is the target-dir-resolved instance id ('main' outside
 *   the multi-instance world).
 */
function loadConfig(projectDir, target, options) {
  options = options || {};

  if (target && !TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}" — must be one of [${TARGETS.join(', ')}]`);
  }

  // From a TARGET_SUBDIR (functions/, dist/) the local layer is its own
  // config/omega.json5 (the STAGED compose — the deployed runtime's view).
  // Before any stage exists, fall back to the target root's authored file one
  // level up, so a bare emulator/loadConfig from the functions cwd — or a test
  // run resolving from the not-yet-staged dist/ — sees the same layers the
  // stage would compose.
  let localPath = resolveConfigPath(projectDir);
  if (!localPath && TARGET_SUBDIRS.includes(path.basename(path.resolve(projectDir)))) {
    localPath = resolveConfigPath(path.dirname(path.resolve(projectDir)));
  }
  const brandPath = findBrandConfigPath(projectDir);
  const companyPath = findCompanyConfigPath(projectDir);

  // The local-layer file is OPTIONAL inside a brand monorepo (Ian 2026-07-13:
  // the brand file's targets section IS the per-target home) — a target with
  // no omega.json5 of its own rides the brand file alone. Standalone
  // projects (no brand config above) still require their own file.
  if (!localPath && !brandPath) {
    throw new Error(`No ${FILE_NAME} found under ${projectDir} (looked in ${CONFIG_LOCATIONS.join(', ')}) — probe with hasOmegaConfig() first; legacy configs must be migrated (see docs/shared/config.md)`);
  }

  const local = localPath ? readConfigFile(localPath) : {};
  const brand = brandPath ? readConfigFile(brandPath) : null;
  const company = companyPath ? readConfigFile(companyPath) : null;

  assertUsableRawFile(companyPath, company);
  assertUsableRawFile(brandPath, brand);
  assertUsableRawFile(localPath, local);

  const inherited = stripCompanyPlumbing(company);

  // ─── Resolve ─────────────────────────────────────────────────────────────
  const hasTargets = !!((inherited && inherited.targets) || (brand && brand.targets) || local.targets);
  const targets = deepMerge(inherited ? inherited.targets : null, brand ? brand.targets : null, local.targets);

  // Instance dimension (multi-instance targets): WHICH instance this target is
  // comes from its dir name (targets/website-admin → web/admin; the canonical
  // dir → main). Only brand-monorepo targets resolve through the walk — a
  // standalone project's dir name is arbitrary and always means main.
  let targetRoot = path.resolve(projectDir);
  if (TARGET_SUBDIRS.includes(path.basename(targetRoot))) {
    targetRoot = path.dirname(targetRoot);
  }
  const instance = target && brandPath ? instanceIdFromDirName(path.basename(targetRoot), target) : MAIN_INSTANCE;

  const config = target
    ? deepMerge(
        schemaDefaults(target),
        options.defaults,
        stripTargets(inherited),
        inherited && inherited.targets ? resolveInstanceEntry(inherited.targets[target], instance) : null,
        stripTargets(brand),
        brand && brand.targets ? resolveInstanceEntry(brand.targets[target], instance) : null,
        stripTargets(local),
        local.targets ? resolveInstanceEntry(local.targets[target], instance) : null,
      )
    : deepMerge(schemaDefaults(), options.defaults, inherited, brand, local);

  // Keep the merged targets map on the resolved config (presence = enabled)
  if (target && hasTargets) {
    config.targets = targets;
  }

  // The instance's own public URL (#588): an entry's explicit `url` already
  // merged to the top level above, and a bare `{ id: 'admin' }` derives
  // https://admin.<brand host> through the ONE resolver, landing in that same
  // place, so every reader of the resolved config (site-global's site.url, the
  // web deploy's host + CNAME) sees the instance's url and not the main site's.
  // `main` derives nothing: brand.url IS its url.
  //
  // A brand.url OVERRIDE that reached this instance (the instance entry's own
  // `brand.url`, an instance target dir's local layer, a dev layer pointing at
  // localhost) IS the instance url already, never a base to stack the id on:
  // deriving there gave shop.shop.acme.test and https://admin.localhost:4000.
  // The test is whether the resolved brand.url still equals the BRAND layer's.
  if (target && instance !== MAIN_INSTANCE && !config.url) {
    const brandLayerUrl = (brand && brand.brand && brand.brand.url)
      || (inherited && inherited.brand && inherited.brand.url)
      || null;
    const resolvedUrl = (config.brand && config.brand.url) || null;

    const instanceUrl = resolvedUrl && resolvedUrl !== brandLayerUrl
      ? resolvedUrl
      : resolveInstanceUrl(targets ? targets[target] : null, instance, config);

    if (instanceUrl) {
      config.url = instanceUrl;
    }
  }

  const enabled = target
    ? hasTargets && Object.prototype.hasOwnProperty.call(targets, target)
    : null;

  const { errors, warnings } = validateConfig(config, { target });

  return { config, errors, warnings, enabled, instance, files: { local: localPath, brand: brandPath, company: companyPath } };
}

/**
 * Compose the company+brand+local layers into ONE self-contained config file for
 * a target's deploy upload (friction #31). The runtime's brand walk-up dies at
 * the upload boundary — `firebase deploy` ships only the functions folder —
 * so the staged file must carry the layers above it itself. The target's full
 * interleave (company shared ← company targets[target] ← brand shared ← brand
 * targets[target] ← local shared ← local targets[target]) is frozen into the
 * shared namespace: the deployed
 * runtime's own `deepMerge(defaults, shared, targets[target])` then yields
 * EXACTLY the local resolution. `targets` keeps presence-only keys
 * (presence = enabled; every value is already folded in, so nothing
 * re-applies above the frozen interleave — a raw merged targets map would
 * let a brand-target value beat a local-shared one, flipping the chain).
 * Framework defaults are NOT baked in: the deployed runtime applies its
 * own, so defaults evolve with the shipped package, not the deploy moment.
 *
 * The local-layer file is OPTIONAL inside a brand monorepo (same rule as
 * loadConfig since cp121c): a target with no omega.json5 of its own composes
 * from the brand file alone. Standalone projects still require their file.
 *
 * @param {string} projectDir - Target root or one of its TARGET_SUBDIRS (functions/, dist/).
 * @param {string} target - Canonical target the upload serves ('backend').
 * @returns {{ config: object, files: { local: string|null, brand: string|null, company: string|null } }}
 *   `files.brand` null = no brand layer above the target (already self-contained);
 *   `files.local` null = the target rides the brand file alone; `files.company`
 *   null = the brand is not stamped into a company workspace.
 */
function composeTargetConfig(projectDir, target) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}" — must be one of [${TARGETS.join(', ')}]`);
  }

  // Compose is a BUILD-time op over the AUTHORED layers: a TARGET_SUBDIR
  // (functions/, dist/) normalizes up to its target root, so a previously-staged
  // config/omega.json5 (compose OUTPUT) can never read back in as a local
  // layer — that would freeze brand edits behind the last stage.
  let targetRoot = path.resolve(projectDir);
  if (TARGET_SUBDIRS.includes(path.basename(targetRoot))) {
    targetRoot = path.dirname(targetRoot);
  }

  const localPath = resolveConfigPath(targetRoot);
  const brandPath = findBrandConfigPath(targetRoot);
  const companyPath = findCompanyConfigPath(targetRoot);
  if (!localPath && !brandPath) {
    throw new Error(`No ${FILE_NAME} found under ${projectDir} (looked in ${CONFIG_LOCATIONS.join(', ')})`);
  }

  const local = localPath ? readConfigFile(localPath) : {};
  const brand = brandPath ? readConfigFile(brandPath) : null;
  const company = companyPath ? readConfigFile(companyPath) : null;

  assertUsableRawFile(companyPath, company);
  assertUsableRawFile(brandPath, brand);
  assertUsableRawFile(localPath, local);

  const inherited = stripCompanyPlumbing(company);

  // Same instance dimension as loadConfig: the target dir names the instance
  // whose entry is this compose's target layer (main outside a brand).
  const instance = brandPath ? instanceIdFromDirName(path.basename(targetRoot), target) : MAIN_INSTANCE;

  const config = deepMerge(
    stripTargets(inherited),
    inherited && inherited.targets ? resolveInstanceEntry(inherited.targets[target], instance) : null,
    stripTargets(brand),
    brand && brand.targets ? resolveInstanceEntry(brand.targets[target], instance) : null,
    stripTargets(local),
    local.targets ? resolveInstanceEntry(local.targets[target], instance) : null,
  );

  const hasTargets = !!((inherited && inherited.targets) || (brand && brand.targets) || local.targets);
  if (hasTargets) {
    const targets = deepMerge(inherited ? inherited.targets : null, brand ? brand.targets : null, local.targets);
    config.targets = Object.fromEntries(Object.keys(targets).map((name) => [name, {}]));
  }

  return { config, files: { local: localPath, brand: brandPath, company: companyPath } };
}

module.exports = { loadConfig, composeTargetConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets, findBrandRoot, findBrandConfigPath, resolveBrandRoot, FILE_NAME, CONFIG_LOCATIONS, TARGET_SUBDIRS };
