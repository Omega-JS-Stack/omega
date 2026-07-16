/**
 * Motion Module
 * Boots the shared @omega.js/client motion engine (reveals, count-ups, word
 * rotators, marquees, scroll watchers — see core/css/motion/_index.scss for
 * the attribute contract). The html[data-omega-motion] stamp that gates the
 * reveal styles is emitted inline by core/head.html before first paint.
 */
import omega from '@omega.js/client';
import { createMotion } from '@omega.js/client/modules/motion.js';

// Module
export default () => {
  const motion = createMotion();

  // Register on UJ library for programmatic access (omega.uj().motion.scan(el))
  omega._ujLibrary.motion = motion;

  motion.start();

  console.log('Motion module loaded');
};
