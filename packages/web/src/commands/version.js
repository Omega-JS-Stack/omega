/**
 * `omega version` — print the framework version.
 */
const Logger = require('@omegajs/devkit/logger');

const logger = new Logger('omega:version');
const pkg = require('../../package.json');

module.exports = async function (options) {
  logger.log(pkg.version);
};
