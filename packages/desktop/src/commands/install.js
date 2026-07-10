// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('install');
const { safeInstall } = require('../utils/safe-install');
const local = require('@omegajs/devkit/local');

const package = Manager.getPackage('main');

module.exports = async function (options) {
  logger.log(`Installing ${package.name}...`);

  const type = options._[1] || 'prod';

  try {
    if (['live', 'prod', 'p', 'production'].includes(type)) {
      logger.log('Installing production...');
      await run(`npm uninstall ${package.name}`);
      await run(`npm install ${package.name}@latest --save-dev`);
      return logger.log('Production installation complete.');
    }

    if (['dev', 'd', 'development', 'local', 'l'].includes(type)) {
      logger.log('Installing development (local Omega monorepo)...');
      await local.linkLocalPackages({
        dir: process.cwd(),
        monorepoRoot: local.resolveMonorepoRoot(),
        logger,
      });
      return logger.log('Development installation complete.');
    }
  } catch (e) {
    logger.error('Error during install:', e);
  }
};

function run(command) {
  return safeInstall(command);
}
