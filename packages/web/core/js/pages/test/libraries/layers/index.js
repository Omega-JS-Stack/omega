/**
 * /test — Global (framework default) page JS — the first layer.
 * Turns the "js-global" dot green to prove this layer loaded + ran.
 */

import { createLogger } from '__main_assets__/js/libs/logger.js';

const logger = createLogger('test:layers');

export default ({ manager, options }) => {
  const dot = document.querySelector('.layer-dot[data-layer="js-global"]');
  if (dot) {
    dot.style.background = '#30a46c'; // green
  }
  logger.log('global JS ran → js-global dot green');
};
