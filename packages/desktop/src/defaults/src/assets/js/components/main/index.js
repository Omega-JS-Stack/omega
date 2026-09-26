// Main window renderer entry.
import omega from '@omega.js/desktop/renderer';

omega.initialize()
  .then(() => {
    const { logger, desktop } = omega;

    // Add your main-window UI logic here.
    // ...

    logger.log('Main window initialized!');
  });
