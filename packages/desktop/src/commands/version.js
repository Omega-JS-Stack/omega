// Libraries
const build = require('../build.js');
const logger = build.logger('version');

const package = build.getPackage('main');

module.exports = async function (options) {
  logger.log(package.version);
};
