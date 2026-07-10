// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('clean');
const { cleanDirs } = require('@omega.js/devkit/clean-dirs');

// Dirs to clean
const dirs = [
  '.temp',
  'dist',
  'packaged',
  // 'src/assets/themes',
]

module.exports = async function (options) {
  // Log
  logger.log(`Cleaning up .temp, dist, and packaged directories...`);

  try {
    cleanDirs(dirs);
  } catch (e) {
    logger.error(`Error clearing directories: ${e}`);
  }
};
