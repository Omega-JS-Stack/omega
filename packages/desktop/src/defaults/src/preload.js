// Preload entry. Exposes window.desktop to the renderer via contextBridge.
const omega = require('@omega.js/desktop/preload');

omega.initialize()
  .then(() => {
    const { logger } = omega;

    // Add any extra contextBridge-exposed APIs here. Be careful — anything you expose runs
    // in the renderer's context, so don't pass through privileged Node APIs without care.
    // ...

    logger.log('Preload initialized!');
  });
