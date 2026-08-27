/**
 * @omega.js/config — the single config format for every OMEGA project type.
 *
 * One file, config/omega.json5 (functions/config/omega.json5 for standalone
 * backends), identical shape everywhere: shared sections (brand,
 * cloud, analytics, payment, monitoring, oauth2, theme) + a `targets`
 * object whose KEY PRESENCE says which targets a brand enables and whose
 * values hold target-scoped settings — any shared key inside a target entry
 * overrides the shared value for that surface (one agnostic deep merge).
 *
 * Replaces the per-framework config zoo (UJM's _config.yml + JSON split,
 * EM's config/electron-manager.json, @omega.js/backend's backend-manager-config.json,
 * BXM's config) with NO dual-read: each framework flips to omega.json5
 * outright and legacy brands migrate their file once (docs/shared/config.md has
 * the mapping tables). omega-manager's disperse enumerates SHARED_SECTIONS
 * instead of hardcoding per-target mapping blocks.
 *
 * Private workspace package — vendored/bundled into the published frameworks
 * at prepare time, never published on its own.
 */

const { TARGETS, CUSTOM_TARGET_TYPE, isCustomTargetEntry, BACKEND_PROJECT_TYPES, backendProjectType, SHARED_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS, BRAND_ID_PATTERN } = require('./schema.js');
const { deepMerge } = require('./merge.js');
const { findSecretKeys, SECRET_KEY_PATTERN } = require('./secrets.js');
const { findRetiredKeys, RETIRED_KEYS, RETIRED_PATHS } = require('./retired-keys.js');
const { chosenProvider } = require('./providers.js');
const { validateConfig, runSchema, formatErrors } = require('./validate.js');
const { loadConfig, composeTargetConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets, findBrandRoot, findBrandConfigPath, resolveBrandRoot, FILE_NAME, CONFIG_LOCATIONS } = require('./load.js');
const { loadEnv, resolveEnvChain, loadEnvChain } = require('./env.js');
const { ENV_SCHEMA, ENV_GROUPS, envFileGroups, envSchemaEntry, envKeysForTarget, generatedEnvKeys, requiredEnvKeys, devEnvKeys, devEnvKeyMap, envKeysByGroup } = require('./env-schema.js');
const { readCompanyRoot, COMPANY_MARKER } = require('./company.js');
const { applyConfigEdits, writeConfigValues, applyConfigRemovals, removeConfigValues } = require('./edit.js');
const { schemaDefaults, missingDefaults, defaultComments } = require('./defaults.js');
const { applyCanonicalOrder, CANONICAL_TOP_LEVEL_ORDER } = require('./order.js');
const { resolveSeedMode } = require('./seed.js');
const { resolveHook, loadHook } = require('./hooks.js');
const { toSiteGlobal } = require('./site-global.js');
const { resolveWinbackOffer, WINBACK_OFFER_DEFAULTS, WINBACK_DURATIONS } = require('./winback.js');
const { parseRepoSlug, brandRepoName, brandRepoOwner, brandRepo } = require('./repo.js');
const { isDemoProject } = require('./demo.js');
const { CLASSIC_PORTS, CLASSIC_DEV_ORIGIN, isPortFree, resolvePorts, writePortsFile, readPortsFile, clearPortsFile, readSiblingPorts, readSiblingOrigin, envName, portsToEnv, envPort, envPorts } = require('./ports.js');
const { DIR_TARGETS, TARGET_DIRS, MAIN_INSTANCE, INSTANCE_ID_PATTERN, normalizeTargetInstances, instanceIdFromDirName, instanceTargetDir, targetInstance, resolveInstanceEntry, instancePortOffset, resolveInstanceUrl } = require('./instances.js');

module.exports = {
  // Loading
  loadConfig,
  composeTargetConfig,
  hasOmegaConfig,
  resolveConfigPath,
  getEnabledTargets,
  findBrandRoot,
  findBrandConfigPath,
  resolveBrandRoot,
  FILE_NAME,
  CONFIG_LOCATIONS,

  // .env cascade (shell > local .env > brand .env > company .env)
  loadEnv,
  resolveEnvChain,
  loadEnvChain,

  // The env schema (#581) — the ONE inventory of the keys OMEGA needs: the
  // manager's mint/order/disperse lanes and the backend's env reader all
  // derive from it, so a new key is one entry, not four edits
  ENV_SCHEMA,
  ENV_GROUPS,
  envFileGroups,
  envSchemaEntry,
  envKeysForTarget,
  generatedEnvKeys,
  requiredEnvKeys,
  devEnvKeys,
  devEnvKeyMap,
  envKeysByGroup,

  // Company layer discovery (the .omega/company.json stamp) — shared by the
  // config chain, the .env chain, and owner hooks
  readCompanyRoot,
  COMPANY_MARKER,

  // Writeback (comment-preserving edits + canonical top-level key order)
  applyConfigEdits,
  writeConfigValues,
  applyConfigRemovals,
  removeConfigValues,
  applyCanonicalOrder,
  CANONICAL_TOP_LEVEL_ORDER,

  // Schema-derived defaults (#478) — the merge chain's lowest layer, and the
  // heal list the manage walk materializes into a brand's omega.json5
  schemaDefaults,
  missingDefaults,
  defaultComments,

  // Layer-aware consumer seeding (brand target = no local-layer config at all)
  resolveSeedMode,

  // Owner hooks (config/hooks/<call-site>.js — brand root, then company root)
  resolveHook,
  loadHook,

  // Template surface
  toSiteGlobal,

  // The cancel-flow save offer (#268) — ONE home for the 50%-off default, read
  // by the backend's apply route and baked into the web client blob at build
  resolveWinbackOffer,
  WINBACK_OFFER_DEFAULTS,
  WINBACK_DURATIONS,

  // Brand repo derivation from the shared repo.providers.github block, overlaid
  // by a target's own github entry (backend: targets.backend.github.repo slug —
  // "owner/name" or bare name; name → brand.id, owner → repo.providers.github.org)
  parseRepoSlug,
  // demo-* project ids are emulator-only (Firebase's convention) — cloud
  // surfaces short-circuit on this instead of 403ing at Google
  isDemoProject,
  brandRepoName,
  brandRepoOwner,
  // The finished form a framework hands to consumer code (#290) — owner, name,
  // and the "owner/name" slug — so brands never re-derive the rule
  brandRepo,

  // Validation
  validateConfig,
  runSchema,
  formatErrors,
  findSecretKeys,
  SECRET_KEY_PATTERN,
  findRetiredKeys,
  RETIRED_KEYS,
  RETIRED_PATHS,

  // The one provider shape (#425) — `role.providers.<provider>`, where key
  // presence is the pick and `false` is the deliberate off switch
  chosenProvider,

  // Merge
  deepMerge,

  // Port auto-allocation (N7 — dev/emulator only)
  CLASSIC_PORTS,
  CLASSIC_DEV_ORIGIN,
  isPortFree,
  resolvePorts,
  writePortsFile,
  readPortsFile,
  clearPortsFile,
  readSiblingPorts,
  readSiblingOrigin,
  envName,
  portsToEnv,
  envPort,
  envPorts,

  // Multi-instance targets (_attic/plans/multi-instance-targets.md): normalization
  // is the ONE iteration mechanism — object form = [{ id: 'main', ...entry }]
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

  // Schema (pure data)
  TARGETS,
  CUSTOM_TARGET_TYPE,
  isCustomTargetEntry,
  BACKEND_PROJECT_TYPES,
  backendProjectType,
  SHARED_SECTIONS,
  SHARED_SCHEMA,
  TARGET_SCHEMAS,
  BRAND_ID_PATTERN,
};
