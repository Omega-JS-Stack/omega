// Settings window renderer entry.
const Manager = require('@omega.js/desktop/renderer');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { logger } = manager;
    logger.log('Settings window initialized!');
  });
