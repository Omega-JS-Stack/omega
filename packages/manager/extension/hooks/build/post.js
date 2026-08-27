// Libraries
const Manager = new (require('@omega.js/extension/build'));
const logger = Manager.logger('build:post');

// Hook
module.exports = async ({ projectRoot, mode }) => {
  logger.log(`Running in ${mode} mode from ${projectRoot}`);
}
