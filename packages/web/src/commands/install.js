/**
 * `omega install [type]` — `i local` links every declared @omega.js/* dep
 * from the local Omega monorepo (idempotent); `i live`/`prod` restores
 * registry specs TREE-WIDE (the publish-day inverse: every file: spec flips
 * to ^<linked version> and one install re-resolves from the registry).
 */
const Logger = require('@omega.js/devkit/logger');
const local = require('@omega.js/devkit/local');

const logger = new Logger('omega:install');

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

  logger.log('Installing production (restoring registry specs tree-wide)...');
  const actions = await local.restoreRegistrySpecs({ dir: process.cwd(), logger });
  const flipped = actions.filter((action) => action.action === 'flip').length;
  logger.log(flipped > 0
    ? `Production installation complete (${flipped} spec(s) restored to registry ranges).`
    : 'Already on registry specs — nothing to flip.');
};
