// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('clean');
const { cleanDirs } = require('@omega.js/devkit/clean-dirs');
const { ensureTarget } = require('./lib/ensure-target.js');

// Dirs to clean
const dirs = [
  '.temp',
  'dist',
  'packaged',
  // 'src/assets/themes',
]

module.exports = async function (options) {
  // The local scaffold (#675): the consumer `start` and `build` scripts are
  // `npx omega clean && … npm run gulp …`, and gulp itself is one of the peer
  // deps the ensure installs — clean is the only verb that runs before it.
  await ensureTarget({ log: (line) => logger.log(line), warn: (line) => logger.warn(line) });

  // Log
  logger.log(`Cleaning up .temp, dist, and packaged directories...`);

  try {
    cleanDirs(dirs);
  } catch (e) {
    logger.error(`Error clearing directories: ${e}`);
  }
};
