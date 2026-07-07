/**
 * @omegajs/manager — the OMEGA orchestration engine for brand monorepos.
 * Public surface: the manage runner, the service-runner factory (services
 * and tests build on it), brand/state loading, and the registry.
 */

const { runManage } = require('./manage.js');
const { createServiceRunner, splitReturn, getOperationHandler } = require('./lib/service-runner.js');
const { RunSummary } = require('./lib/run-summary.js');
const { resolveBrandRoot, loadBrand, discoverApps, targetFromDirName } = require('./lib/brand.js');
const { readState, writeState, writeRunOutput, statePath, STATE_DIR } = require('./lib/state.js');
const {
  SERVICE_ORDER,
  OPERATIONS,
  DEFAULTS,
  APP_DIR_TARGETS,
  TARGET_APP_DIRS,
  templateObject,
} = require('./config.js');

module.exports = {
  // Orchestrator
  runManage,

  // Service framework
  createServiceRunner,
  splitReturn,
  getOperationHandler,
  RunSummary,

  // Brand + state
  resolveBrandRoot,
  loadBrand,
  discoverApps,
  targetFromDirName,
  readState,
  writeState,
  writeRunOutput,
  statePath,
  STATE_DIR,

  // Registry
  SERVICE_ORDER,
  OPERATIONS,
  DEFAULTS,
  APP_DIR_TARGETS,
  TARGET_APP_DIRS,
  templateObject,
};
