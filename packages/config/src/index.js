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
 * outright and legacy brands migrate their file once (docs/config.md has
 * the mapping tables). omega-manager's disperse enumerates SHARED_SECTIONS
 * instead of hardcoding per-target mapping blocks.
 *
 * Private workspace package — vendored/bundled into the published frameworks
 * at prepare time, never published on its own.
 */

const { TARGETS, SHARED_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS } = require('./schema.js');
const { deepMerge } = require('./merge.js');
const { findSecretKeys, SECRET_KEY_PATTERN } = require('./secrets.js');
const { validateConfig, runSchema, formatErrors } = require('./validate.js');
const { loadConfig, composeTargetConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets, findBrandRoot, resolveBrandRoot, FILE_NAME, CONFIG_LOCATIONS } = require('./load.js');
const { loadEnv, resolveEnvChain, loadEnvChain, readCompanyRoot, COMPANY_MARKER } = require('./env.js');
const { applyConfigEdits, writeConfigValues } = require('./edit.js');
const { applyCanonicalOrder, CANONICAL_TOP_LEVEL_ORDER } = require('./order.js');
const { renderBrandAppSeed, resolveSeedMode } = require('./seed.js');
const { resolveHook, loadHook } = require('./hooks.js');
const { toSiteGlobal } = require('./site-global.js');
const { parseRepoWebsite, brandRepoName, brandRepoOwner } = require('./repo.js');
const { CLASSIC_PORTS, isPortFree, resolvePorts, writePortsFile, readPortsFile, clearPortsFile, envName, portsToEnv, envPort } = require('./ports.js');

module.exports = {
  // Loading
  loadConfig,
  composeTargetConfig,
  hasOmegaConfig,
  resolveConfigPath,
  getEnabledTargets,
  findBrandRoot,
  resolveBrandRoot,
  FILE_NAME,
  CONFIG_LOCATIONS,

  // .env cascade (shell > app .env > brand .env > company .env)
  loadEnv,
  resolveEnvChain,
  loadEnvChain,
  readCompanyRoot,
  COMPANY_MARKER,

  // Writeback (comment-preserving edits + canonical top-level key order)
  applyConfigEdits,
  writeConfigValues,
  applyCanonicalOrder,
  CANONICAL_TOP_LEVEL_ORDER,

  // Layer-aware consumer seeding (brand-app = targets-only)
  renderBrandAppSeed,
  resolveSeedMode,

  // Owner hooks (config/hooks/<call-site>.js — brand root, then company root)
  resolveHook,
  loadHook,

  // Template surface
  toSiteGlobal,

  // Brand repo derivation (name: github.repo → repo_website URL → brand.id;
  // owner: repo_website URL → github.org — legacy orgMain/orgWebsite split)
  parseRepoWebsite,
  brandRepoName,
  brandRepoOwner,

  // Validation
  validateConfig,
  runSchema,
  formatErrors,
  findSecretKeys,
  SECRET_KEY_PATTERN,

  // Merge
  deepMerge,

  // Port auto-allocation (N7 — dev/emulator only)
  CLASSIC_PORTS,
  isPortFree,
  resolvePorts,
  writePortsFile,
  readPortsFile,
  clearPortsFile,
  envName,
  portsToEnv,
  envPort,

  // Schema (pure data)
  TARGETS,
  SHARED_SECTIONS,
  SHARED_SCHEMA,
  TARGET_SCHEMAS,
};
