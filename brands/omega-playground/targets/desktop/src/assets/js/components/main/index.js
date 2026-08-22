// Main window renderer entry.
const Manager = require('@omega.js/desktop/renderer');

const manager = new Manager();

manager.initialize()
  .then(() => {
    const { logger, ipc, storage, omega } = manager;

    // Add your main-window UI logic here.
    // ...

    logger.log('Main window initialized!');
  });
