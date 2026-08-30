// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('clean');
const jetpack = require('fs-jetpack');
const { cleanDirs } = require('@omega.js/devkit/clean-dirs');
const { ensureTarget } = require('./lib/ensure-target.js');

// Dirs to clean
const dirs = [
  '.temp',
  '.cache',
  'dist',
  'release',
];

module.exports = async function (options) {
  // The local scaffold (#675): the consumer `start` script is
  // `npx omega clean && npm run gulp --`, and gulp itself is one of the peer
  // deps the ensure installs — clean is the only verb that runs before it.
  await ensureTarget({ log: (line) => logger.log(line), warn: (line) => logger.warn(line) });

  // Quick mode: keep existing build artifacts so the next gulp run is incremental.
  // Only short-circuit if there's actually a dist/ to reuse — first runs still need a real clean.
  if (Manager.isQuickMode()) {
    if (jetpack.exists('dist')) {
      logger.log('Quick mode: Skipping clean');
      return;
    }
    logger.log('Quick mode: No existing build, running full clean');
  }

  logger.log('Cleaning .temp, .cache, dist, release...');

  try {
    cleanDirs(dirs);
  } catch (e) {
    logger.error(`Error clearing directories: ${e}`);
  }
};
