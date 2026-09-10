/**
 * `omega version` — print the framework version.
 */
const Logger = require('@omega.js/devkit/logger');

const logger = new Logger('version');
const pkg = require('../../package.json');

module.exports = async function (options) {
  logger.log(pkg.version);
};
