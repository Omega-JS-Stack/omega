// About window renderer entry.
const Manager = require('@omegajs/desktop/renderer');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { logger } = manager;
    logger.log('About window initialized!');
  });
