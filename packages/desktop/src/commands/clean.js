// Libraries
const Manager = new (require('../build.js'));
const logger = Manager.logger('clean');
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
  // `omega clean && npm run gulp --`, and gulp itself is one of the peer
  // deps the ensure installs — clean is the only verb that runs before it.
  await ensureTarget({ log: (line) => logger.log(line), warn: (line) => logger.warn(line) });

  // Quick mode used to keep `dist/` so "the next gulp run is incremental" —
  // a claim webpack never made good on (it rebuilt every bundle anyway) and
  // esbuild retires outright (the numbers are the CHANGELOG's
  // [#737](https://github.com/Omega-JS-Stack/omega/issues/737) entry). Every run
  // cleans, so `--quick` now means exactly one thing: the trimmed
  // electron-builder phase.
  logger.log('Cleaning .temp, .cache, dist, release...');

  try {
    cleanDirs(dirs);
  } catch (e) {
    logger.error(`Error clearing directories: ${e}`);
  }
};
