/**
 * @omega.js/config — the single config format for every OMEGA project type.
 *
 * One file, config/omega.json5 (functions/config/omega.json5 for standalone
 * backends), identical shape everywhere: shared sections (brand,
 * cloud, analytics, payment, monitoring, connections, theme) + a `targets`
 * object whose KEY PRESENCE says which targets a brand enables: every key is a
 * target NAME (the folder under targets/), every entry declares its framework
 * `type`, and any shared key inside a target entry overrides the shared value
 * for that surface (one agnostic deep merge).
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

const { TARGETS, CUSTOM_TARGET_TYPE, isCustomTargetEntry, BACKEND_PROJECT_TYPES, backendProjectType, SHARED_SECTIONS, CLIENT_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS, BRAND_ID_PATTERN, AMO_CATEGORIES } = require('./schema.js');
const { clientConfig, CLIENT_FACT_KEYS } = require('./client-config.js');
const { deepMerge } = require('./merge.js');
const { findSecretKeys, SECRET_KEY_PATTERN } = require('./secrets.js');
const { findRetiredKeys, RETIRED_KEYS, RETIRED_PATHS } = require('./retired-keys.js');
const { chosenProvider } = require('./providers.js');
const { validateConfig, runSchema, formatErrors, resolvedBrandHost } = require('./validate.js');
const { loadConfig, composeTargetConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets, findBrandRoot, findBrandConfigPath, resolveBrandRoot, FILE_NAME, CONFIG_LOCATIONS } = require('./load.js');
const { ENV_ENVIRONMENTS, ENVIRONMENT_VAR, getEnvironment, isDevelopment, isProduction, isTesting, setEnvironment, buildLaneEnvironment, attachTo: attachEnvironment } = require('./environment.js');
const { loadEnv, reloadEnv, envEnvironment, resolveEnvChain, envLayerFiles, loadEnvChain, loadEnvRoots, applyDeliverAs, composeTargetEnv, envLine, serializeEnv } = require('./env.js');
const { ENV_SCHEMA, ENV_GROUPS, DELIVERY_MODES, envFileGroups, envSchemaEntry, envKeysForTarget, generatedEnvKeys, requiredEnvKeys, envKeysByGroup } = require('./env-schema.js');
const { WORKFLOW_OWNED_KEYS, deliveredKeys, workflowSecretKeys, envFileKeys, artifactEnvValues, bakeKeys, bakeSourceKeys, publishSecretKeys, renderSecretsBlock, renderEnvFileKeys } = require('./env-delivery.js');
const { checkEnvRules } = require('./env-rules.js');
const { RETIRED_ENV_KEYS, findRetiredEnvKeys, assertNoRetiredEnvKeys } = require('./env-retired.js');
const { resolveCompany, recordBrand, readRegistry, registryFile, COMPANY_DIR, COMPANY_RESOLVED_FILE, COMPANY_SELF } = require('./company.js');
const { applyConfigEdits, writeConfigValues, applyConfigRemovals, removeConfigValues } = require('./edit.js');
const { schemaDefaults, missingDefaults, defaultComments } = require('./defaults.js');
const { applyCanonicalOrder, CANONICAL_TOP_LEVEL_ORDER } = require('./order.js');
const { resolveSeedMode } = require('./seed.js');
const { resolveHook, loadHook } = require('./hooks.js');
const { toSiteGlobal } = require('./site-global.js');
const { PLATFORMS, FORMATS, enabledFormats, formatKeys, desktopProductName, sanitizeProductName, desktopArtifactName, desktopArtifactNames } = require('./platforms.js');
const { resolveWinbackOffer, WINBACK_OFFER_DEFAULTS, WINBACK_DURATIONS } = require('./winback.js');
const { REPO_PROVIDERS, HOSTING_PROVIDERS, repoBlock, sourceRepo, releasesRepo, websiteRepo, hostingProvider, pagesHost, brandVisibility } = require('./repo.js');
const { isDemoProject } = require('./demo.js');
const { deriveBundleIdPrefix, composeBundleId } = require('./bundle-id.js');
const { DEV_FACT_CHANNEL, devFactMissing } = require('./dev-facts.js');
const { CLASSIC_PORTS, CLASSIC_DEV_ORIGIN, isPortFree, resolvePorts, writePortsFile, readPortsFile, clearPortsFile, readSiblingPorts, readSiblingOrigin, envName, portsToEnv, envPort, envPorts } = require('./ports.js');
const { TARGET_NAME_PATTERN, TARGET_TYPES, targetEntries, targetsOfType, hasTargetOfType, targetPath, targetNameFromDir, targetUrl, targetPortOffset, brandHost } = require('./targets.js');

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

  // The ONE environment vocabulary ('development' | 'testing' | 'production'):
  // the overlay's file suffix and every framework's own environment answer
  ENV_ENVIRONMENTS,
  // The ONE environment module every target answers from (#817): one input
  // (OMEGA_ENVIRONMENT on Node, the baked config.environment in a browser),
  // no per-surface default, a missing input is a loud error. `attachEnvironment`
  // is its attachTo(), named for what it mixes in.
  ENVIRONMENT_VAR,
  getEnvironment,
  isDevelopment,
  isProduction,
  isTesting,
  setEnvironment,
  // The word a node BUILD LANE is for, from its build-mode flag and whatever a
  // parent lane named: the desktop and extension build Managers set this
  buildLaneEnvironment,
  attachEnvironment,
  // The AMBIENT answer a lane resolves when nothing named one for it, and the
  // producer of the input above
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
  deliveredKeys,
  workflowSecretKeys,
  envFileKeys,
  artifactEnvValues,
  bakeKeys,
  bakeSourceKeys,
  publishSecretKeys,
  renderSecretsBlock,
  renderEnvFileKeys,

  // The env presence checker (#626) — the ONE evaluator of `required` and
  // `requiredWhen`; every consumer calls it, none keeps its own if
  checkEnvRules,

  // The .env half of the retired-key register (#893): a key that moved into
  // config fails the layer that still declares it, naming the move. Every
  // `.env` read goes through parseEnvFile, so nothing can miss the check
  RETIRED_ENV_KEYS,
  findRetiredEnvKeys,
  assertNoRetiredEnvKeys,

  // The ONE company resolver (#677): `company: { id }` in, the company's public
  // facts plus its tree on this machine out. The config chain, the .env chain,
  // owner hooks and the desktop signing tree all inherit through its `file()`,
  // so a new kind of inherited file needs no code anywhere
  resolveCompany,
  // The machine registry `~/.omega/brands.json` every loadConfig refreshes its
  // own line in, which is what makes a sibling's `company: { id }` resolvable
  recordBrand,
  readRegistry,
  registryFile,
  COMPANY_DIR,
  COMPANY_SELF,
  // The generated layer a deploy hands a runner, which has no registry and no
  // company tree to resolve from
  COMPANY_RESOLVED_FILE,

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

  // The ONE browser-safe subset (#894): what web's page chrome, desktop's
  // renderer bundle and every extension bundle bake as OMEGA_BUILD_JSON.config
  clientConfig,
  CLIENT_FACT_KEYS,

  // The ONE shipping vocabulary and format table (#867): what each target can
  // ship, what each format needs, and the versionless asset names (#620)
  // @omega.js/desktop packages under and the site links straight at
  PLATFORMS,
  FORMATS,
  enabledFormats,
  formatKeys,
  desktopProductName,
  sanitizeProductName,
  desktopArtifactName,
  desktopArtifactNames,

  // The cancel-flow save offer (#268) — ONE home for the 50%-off default, read
  // by the backend's apply route and baked into the web client blob at build
  resolveWinbackOffer,
  WINBACK_OFFER_DEFAULTS,
  WINBACK_DURATIONS,

  // demo-* project ids are emulator-only (Firebase's convention) — cloud
  // surfaces short-circuit on this instead of 403ing at Google
  isDemoProject,

  // The repo derivations (#883): ONE `repo: { provider, org }` block, and every
  // repo a brand owns derives its name from `<brand.id>-<role>` (#809), so no
  // name, owner or visibility is ever configured
  REPO_PROVIDERS,
  HOSTING_PROVIDERS,
  repoBlock,
  // The SOURCE monorepo `<brand.id>-omega`: the dispatch, the repo secrets, the
  // scaffolded workflows and the CMS commits all address this one
  sourceRepo,
  // The brand's ONE public releases repo `<brand.id>-releases`, always public:
  // the one home every release reader takes its address from
  releasesRepo,
  // A web target's own repo `<brand.id>-<name>`, holding the BUILT site so the
  // source monorepo can stay private, plus where that target is served from
  websiteRepo,
  hostingProvider,
  // The Pages custom domain of a web target: the manage walk sets it on the
  // repo, the deploy writes it into the CNAME, from this ONE derivation
  pagesHost,
  // Visibility has ONE statement, the brand root's package.json `private`
  brandVisibility,

  // The bundle-identifier policy ([#909](https://github.com/Omega-JS-Stack/omega/issues/909)):
  // ONE derivation for the id the certificates service registers and the id the
  // desktop build signs under
  deriveBundleIdPrefix,
  composeBundleId,

  // Validation
  validateConfig,
  runSchema,
  formatErrors,

  // The brand's own HOST, resolved from a target `url` or `brand.url`, the
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
  // The ONE missing-dev-fact error (#834): no surface carries a browser-side
  // copy of the classic numbers any more, so a read that finds no baked map
  // throws this instead of assuming one
  DEV_FACT_CHANNEL,
  devFactMissing,

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

  // The targets map (#886): every key is a NAME, every entry declares its
  // `type`, and the name IS the folder, so this is the ONE derivation of a
  // target's path, its dir walk, its public url, and its dev-port offset
  TARGET_NAME_PATTERN,
  TARGET_TYPES,
  targetEntries,
  targetsOfType,
  hasTargetOfType,
  targetPath,
  targetNameFromDir,
  targetUrl,
  targetPortOffset,
  brandHost,

  // Schema (pure data)
  TARGETS,
  CUSTOM_TARGET_TYPE,
  isCustomTargetEntry,
  BACKEND_PROJECT_TYPES,
  backendProjectType,
  SHARED_SECTIONS,
  CLIENT_SECTIONS,
  SHARED_SCHEMA,
  TARGET_SCHEMAS,
  BRAND_ID_PATTERN,
  AMO_CATEGORIES,
};
