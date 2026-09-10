/**
 * @omega.js/config — the single config format for every OMEGA project type.
 *
 * One file, config/omega.json5 (functions/config/omega.json5 for standalone
 * backends), identical shape everywhere: shared sections (brand,
 * cloud, analytics, payment, monitoring, connections, theme) + a `targets`
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
const { validateConfig, runSchema, formatErrors, resolvedBrandHost } = require('./validate.js');
const { loadConfig, composeTargetConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets, findBrandRoot, findBrandConfigPath, resolveBrandRoot, FILE_NAME, CONFIG_LOCATIONS } = require('./load.js');
const { loadEnv, reloadEnv, ENV_ENVIRONMENTS, envEnvironment, resolveEnvChain, envLayerFiles, loadEnvChain, loadEnvRoots, applyDeliverAs, composeTargetEnv, envLine, serializeEnv } = require('./env.js');
const { ENV_SCHEMA, ENV_GROUPS, DELIVERY_MODES, envFileGroups, envSchemaEntry, envKeysForTarget, generatedEnvKeys, requiredEnvKeys, envKeysByGroup } = require('./env-schema.js');
const { WORKFLOW_OWNED_KEYS, workflowSecretKeys, bakeKeys, publishSecretKeys, renderSecretsBlock } = require('./env-delivery.js');
const { checkEnvRules } = require('./env-rules.js');
const { readCompanyRoot, COMPANY_MARKER } = require('./company.js');
const { applyConfigEdits, writeConfigValues, applyConfigRemovals, removeConfigValues } = require('./edit.js');
const { schemaDefaults, missingDefaults, defaultComments } = require('./defaults.js');
const { applyCanonicalOrder, CANONICAL_TOP_LEVEL_ORDER } = require('./order.js');
const { resolveSeedMode } = require('./seed.js');
const { resolveHook, loadHook } = require('./hooks.js');
const { toSiteGlobal } = require('./site-global.js');
const { DESKTOP_ARTIFACTS, desktopProductName, sanitizeProductName, desktopArtifactName, desktopArtifactNames } = require('./desktop-artifacts.js');
const { resolveWinbackOffer, WINBACK_OFFER_DEFAULTS, WINBACK_DURATIONS } = require('./winback.js');
const { parseRepoSlug, brandRepoName, brandRepoOwner, brandRepo, releasesRepo } = require('./repo.js');
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

  // .env cascade (shell > local .env > brand .env > company .env), each layer
  // overlaid by its own `.env.<environment>` file (#586)
  loadEnv,
  // The reload half: drops what a file layer owns, then loads again, so an
  // EDITED value lands and the shell still wins (#724)
  reloadEnv,
  resolveEnvChain,
  envLayerFiles,
  loadEnvChain,
  loadEnvRoots,

  // The ONE environment vocabulary ('development' | 'testing' | 'production') —
  // the overlay's file suffix and every framework's own environment answer
  ENV_ENVIRONMENTS,
  envEnvironment,

  // The schema's `deliverAs` rename (#678) — the ONE place a brand-level name
  // becomes the name a target's runtime reads
  applyDeliverAs,

  // The dist/.env composition (#678) — FILES only (company ← brand ← target),
  // schema-filtered per target, written by every verb that stages an artifact
  composeTargetEnv,

  // The .env serializer SSOT — every writeback renders through these
  envLine,
  serializeEnv,

  // The env schema (#581) — the ONE inventory of the keys OMEGA needs: the
  // manager's mint and order lanes, every verb's target delivery, and the
  // backend's env reader all derive from it, so a new key is one entry
  ENV_SCHEMA,
  ENV_GROUPS,
  DELIVERY_MODES,
  envFileGroups,
  envSchemaEntry,
  envKeysForTarget,
  generatedEnvKeys,
  requiredEnvKeys,
  envKeysByGroup,

  // The delivery renderer (#627) — the ONE derivation of how a declared key
  // reaches each target: the generated workflow's secrets block, the build's
  // bake list, and the set a push-secrets publisher sends. No framework keeps
  // a hand-written list, and a secret can never bake into an artifact
  WORKFLOW_OWNED_KEYS,
  workflowSecretKeys,
  bakeKeys,
  publishSecretKeys,
  renderSecretsBlock,

  // The env presence checker (#626) — the ONE evaluator of `required` and
  // `requiredWhen`; every consumer calls it, none keeps its own if
  checkEnvRules,

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

  // The desktop release assets' versionless names (#620) — @omega.js/desktop
  // packages under them, the site links straight at them
  DESKTOP_ARTIFACTS,
  desktopProductName,
  sanitizeProductName,
  desktopArtifactName,
  desktopArtifactNames,

  // The cancel-flow save offer (#268) — ONE home for the 50%-off default, read
  // by the backend's apply route and baked into the web client blob at build
  resolveWinbackOffer,
  WINBACK_OFFER_DEFAULTS,
  WINBACK_DURATIONS,

  // Brand repo derivation from the shared repo.providers.github block, overlaid
  // by a target's own github entry (backend: targets.backend.github.repo slug —
  // "owner/name" or bare name; name → `<brand.id>-omega`, owner → repo.providers.github.org)
  parseRepoSlug,
  // demo-* project ids are emulator-only (Firebase's convention) — cloud
  // surfaces short-circuit on this instead of 403ing at Google
  isDemoProject,
  brandRepoName,
  brandRepoOwner,
  // The finished form a framework hands to consumer code (#290) — owner, name,
  // and the "owner/name" slug — so brands never re-derive the rule
  brandRepo,
  // The brand's ONE public releases repo (#799): `<brand.id>-releases` under the
  // brand repo's owner unless `targets.desktop.releases` names its own, the one
  // home every release reader takes its address from
  releasesRepo,

  // Validation
  validateConfig,
  runSchema,
  formatErrors,

  // The brand's own HOST, resolved from an instance `url` or `brand.url` — the
  // ONE derivation of it ([#708](https://github.com/Omega-JS-Stack/omega/issues/708)):
  // authDomain validation, and every lane that composes a test persona's email
  resolvedBrandHost,

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
