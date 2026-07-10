// Main window renderer entry.
const Manager = require('@omegajs/desktop/renderer');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { logger, ipc, storage, webManager } = manager;

    // Add your main-window UI logic here.
    // ...

    logger.log('Main window initialized!');
  });
