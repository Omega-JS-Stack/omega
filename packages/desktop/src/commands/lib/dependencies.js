/**
 * @omega.js/desktop's half of the shared dependency checks
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)) — the logic is
 * `@omega.js/devkit/target-dependencies` (one copy for every framework); this
 * file is the DATA: which peer deps install as devDependencies, and the
 * framework's own `safeInstall`.
 *
 *   ensurePeerDependencies  the target cannot build without them — LOCAL half,
 *                           ensure-target.js runs it on every verb
 *   updateManager           asks the npm registry whether the framework itself
 *                           is stale — NETWORK half, deploy-precheck.js runs it
 */
const shared = require('@omega.js/devkit/target-dependencies');
const { safeInstall } = require('../../utils/safe-install');

// Peer-dep install location overrides
const DEPENDENCY_MAP = {
  gulp: 'dev',
  electron: 'dev',
  'electron-builder': 'dev',
};

const readProject = shared.readProject;

/** See `@omega.js/devkit/target-dependencies` — bound to desktop's map + installer. */
function ensurePeerDependencies(input) {
  return shared.ensurePeerDependencies({ ...input, dependencyMap: DEPENDENCY_MAP, safeInstall });
}

/** See `@omega.js/devkit/target-dependencies` — bound to desktop's installer. */
function updateManager(input) {
  return shared.updateManager({ ...input, safeInstall });
}

module.exports = { ensurePeerDependencies, updateManager, readProject, DEPENDENCY_MAP };
