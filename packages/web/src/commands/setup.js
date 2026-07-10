/**
 * `omega setup` — prepare/refresh a consumer project:
 *   1. Node version check (warn on mismatch with the framework standard)
 *   2. Scaffold framework defaults (devkit engine + the web FILE_MAP —
 *      marker merges for .gitignore/.env/CLAUDE.md, omega.json5 seed,
 *      Ruby-free CI workflow). No page copying: default pages are virtual.
 *   3. Sync package.json scripts to the omega commands
 *
 * UJM-setup features that arrive with later checkpoints: CNAME generation,
 * firebase auth handler fetch, GitHub secret publishing, post dedupe.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const Logger = require('@omega.js/devkit/logger');
const { scaffoldDefaults, NODE_VERSION } = require('../scaffold.js');

const logger = new Logger('omega:setup');
const pkg = require('../../package.json');

// package.json scripts every consumer gets (UJM projectScripts parity)
const PROJECT_SCRIPTS = {
  setup: 'omega setup',
  start: 'omega dev',
  build: 'omega build',
  test: 'omega test',
  clean: 'omega clean',
  deploy: 'omega deploy',
};

module.exports = async function (options) {
  options = options || {};
  const root = process.cwd();

  logger.log(`Welcome to ${pkg.name} v${pkg.version}!`);

  // ---- Node version check
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < Number(NODE_VERSION)) {
    logger.warn(`Node ${process.versions.node} is older than the framework standard (v${NODE_VERSION}) — update .nvmrc/nvm`);
  }

  // ---- Scaffold defaults
  const result = scaffoldDefaults({ outputDir: root, logger });
  logger.log(`Defaults: ${result.written.length} written, ${result.merged.length} merged, ${result.skipped.length} unchanged`);

  // ---- Sync package.json scripts
  const projectPkgPath = path.join(root, 'package.json');
  const projectPkg = jetpack.exists(projectPkgPath)
    ? JSON.parse(jetpack.read(projectPkgPath))
    : { name: path.basename(root), version: '1.0.0', private: true };

  const before = JSON.stringify(projectPkg);
  projectPkg.scripts = { ...projectPkg.scripts, ...PROJECT_SCRIPTS };
  projectPkg.engines = { ...projectPkg.engines, node: `>=${NODE_VERSION}` };

  if (JSON.stringify(projectPkg) !== before || !jetpack.exists(projectPkgPath)) {
    jetpack.write(projectPkgPath, `${JSON.stringify(projectPkg, null, 2)}\n`);
    logger.log('Synced package.json scripts');
  }

  logger.log('Setup complete');
};
