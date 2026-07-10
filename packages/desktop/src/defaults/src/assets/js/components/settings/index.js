// Settings window renderer entry.
const Manager = require('@omegajs/desktop/renderer');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { logger } = manager;
    logger.log('Settings window initialized!');
  });
