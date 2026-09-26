// Libraries
const build = require('@omega.js/extension/build');
const logger = build.logger('build:post');

// Hook
module.exports = async ({ projectRoot, mode }) => {
  logger.log(`Running in ${mode} mode from ${projectRoot}`);
}
