// Libraries
const build = require('../../build.js');
const logger = build.logger('XXX');

// Load package
const package = build.getPackage('main');
const project = build.getPackage('project');
const rootPathPackage = build.getRootPath('main');
const rootPathProject = build.getRootPath('project');

// Task
module.exports = function XXX(complete) {
  // Log
  logger.log('Starting XXX...');

  // Complete
  return complete();
}
