/**
 * `omega clean` — remove build output and machinery (dist/, .omega/).
 */
const jetpack = require('fs-jetpack');
const Logger = require('@omega.js/devkit/logger');
const { consumerPaths } = require('../consumer.js');

const logger = new Logger('clean');

module.exports = async function (options) {
  const paths = consumerPaths();

  for (const dir of [paths.out, paths.omega]) {
    jetpack.remove(dir);
  }

  logger.log('Removed dist/ and .omega/');
};
