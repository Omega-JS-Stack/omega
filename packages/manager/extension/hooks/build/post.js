// Libraries
const Manager = new (require('@omega.js/extension/build'));
const logger = Manager.logger('build:post');

// Hook
module.exports = async (index) => {
  logger.log('Running with index =', index);
}
