// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('install');
const local = require('@omega.js/devkit/local');

const package = Manager.getPackage('main');

module.exports = async function (options) {
  logger.log(`Installing ${package.name}...`);

  const type = options._[1] || 'prod';

  try {
    if (['live', 'prod', 'p', 'production'].includes(type)) {
      // The publish-day inverse of `i local`: flip every file: spec in the
      // brand tree to the exact <linked version>, then one registry install
      logger.log('Installing production (restoring registry specs tree-wide)...');
      const actions = await local.restoreRegistrySpecs({ dir: process.cwd(), logger });
      const flipped = actions.filter((action) => action.action === 'flip').length;
      return logger.log(flipped > 0
        ? `Production installation complete (${flipped} spec(s) restored to registry ranges).`
        : 'Already on registry specs — nothing to flip.');
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
