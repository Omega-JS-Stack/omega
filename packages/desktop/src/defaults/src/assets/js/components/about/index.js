// About window renderer entry.
import omega from '@omega.js/desktop/renderer';

omega.initialize()
  .then(() => {
    const { logger } = omega;
    logger.log('About window initialized!');
  });
