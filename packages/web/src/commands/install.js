/**
 * `omega install [type]` — `i local` links every declared @omega.js/* dep
 * from the local Omega monorepo (idempotent); `i live`/`prod` reinstalls
 * @omega.js/web from the registry.
 */
const Logger = require('@omega.js/devkit/logger');
const local = require('@omega.js/devkit/local');
const { safeInstall } = require('@omega.js/devkit/safe-install');

const logger = new Logger('omega:install');

const PACKAGE_NAME = require('../../package.json').name;

module.exports = async function (options) {
  const type = options._[1] || 'prod';

  if (['dev', 'd', 'development', 'local', 'l'].includes(type)) {
    logger.log('Installing development (local Omega monorepo)...');
    await local.linkLocalPackages({
      dir: process.cwd(),
      monorepoRoot: local.resolveMonorepoRoot(),
      logger,
    });
    return logger.log('Development installation complete.');
  }

  logger.log('Installing production...');
  await safeInstall(`npm uninstall ${PACKAGE_NAME}`);
  await safeInstall(`npm install ${PACKAGE_NAME}@latest --save-dev`);
  logger.log('Production installation complete.');
};
