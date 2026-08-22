/**
 * @omega.js/manager — the OMEGA orchestration engine for brand monorepos.
 * Public surface: the manage runner, the service-runner factory (services
 * and tests build on it), brand loading, and the registry.
 */

const { runManage } = require('./manage.js');
const { createServiceRunner, splitReturn, getOperationHandler } = require('./lib/service-runner.js');
const { RunSummary } = require('./lib/run-summary.js');
const { resolveBrandRoot, loadBrand, discoverTargets, targetFromDirName } = require('./lib/brand.js');
const { writeRunOutput } = require('./lib/run-output.js');
const {
  SERVICE_ORDER,
  OPERATIONS,
  DEFAULTS,
  DIR_TARGETS,
  TARGET_DIRS,
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

  // Brand + run output
  resolveBrandRoot,
  loadBrand,
  discoverTargets,
  targetFromDirName,
  writeRunOutput,

  // Registry
  SERVICE_ORDER,
  OPERATIONS,
  DEFAULTS,
  DIR_TARGETS,
  TARGET_DIRS,
  templateObject,
};
