// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('install');
const { safeInstall } = require('../lib/safe-install');
const local = require('@omega.js/devkit/local');

// Load package
const package = Manager.getPackage('main');
const project = Manager.getPackage('project');

module.exports = async function (options) {
  // Log
  logger.log(`Installing ${package.name}...`);

  // Get type
  const type = options._[1] || 'prod';

  try {
    // Install production
    if (['live', 'prod', 'p', 'production'].includes(type)) {
      // Log
      logger.log('Installing production...');

      // Install
      await install(`npm uninstall ${package.name}`);
      await install(`npm install ${package.name}@latest --save-dev`);

      // Return
      return logger.log('Production installation complete.');
    }

    // Install development (link from the local Omega monorepo)
    if (['dev', 'd', 'development', 'local', 'l'].includes(type)) {
      // Log
      logger.log('Installing development (local Omega monorepo)...');

      // Link every @omega.js dependency to the monorepo (idempotent)
      await local.linkLocalPackages({
        dir: process.cwd(),
        monorepoRoot: local.resolveMonorepoRoot(),
        logger,
      });

      // Return
      return logger.log('Development installation complete.');
    }

  } catch (e) {
    logger.error(`Error during install:`, e);
  }
};

function install(command) {
  return safeInstall(command);
}
