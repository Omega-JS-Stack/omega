/**
 * @omega.js/config — the single config format for every OMEGA project type.
 *
 * One file, config/omega.json5 (functions/config/omega.json5 for standalone
 * backends), identical shape everywhere: shared sections (brand,
 * firebaseConfig, analytics, payment, sentry, oauth2, theme) + a `targets`
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
const { loadConfig, hasOmegaConfig, resolveConfigPath, getEnabledTargets, findBrandRoot, FILE_NAME, CONFIG_LOCATIONS } = require('./load.js');
const { loadEnv, resolveEnvChain, loadEnvChain, readCompanyRoot, COMPANY_MARKER } = require('./env.js');
const { applyConfigEdits, writeConfigValues } = require('./edit.js');
const { toSiteGlobal } = require('./site-global.js');

module.exports = {
  // Loading
  loadConfig,
  hasOmegaConfig,
  resolveConfigPath,
  getEnabledTargets,
  findBrandRoot,
  FILE_NAME,
  CONFIG_LOCATIONS,

  // .env cascade (shell > app .env > brand .env > company .env)
  loadEnv,
  resolveEnvChain,
  loadEnvChain,
  readCompanyRoot,
  COMPANY_MARKER,

  // Writeback (comment-preserving edits)
  applyConfigEdits,
  writeConfigValues,

  // Template surface
  toSiteGlobal,

  // Validation
  validateConfig,
  runSchema,
  formatErrors,
  findSecretKeys,
  SECRET_KEY_PATTERN,

  // Merge
  deepMerge,

  // Schema (pure data)
  TARGETS,
  SHARED_SECTIONS,
  SHARED_SCHEMA,
  TARGET_SCHEMAS,
};
