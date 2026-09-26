// Libraries
const build = require('../build.js');
const logger = build.logger('version');

// Load package
const package = build.getPackage('main');
const project = build.getPackage('project');

module.exports = async function (options) {
  // Log
  logger.log(package.version);
};
