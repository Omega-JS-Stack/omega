/**
 * Motion Module
 * Registers the shared @omega.js/client motion engine (reveals, count-ups, word
 * rotators, marquees, scroll watchers — see core/css/motion/_index.scss for
 * the attribute contract) on the omega library.
 *
 * It does NOT start the engine: that happens in core/js/first-paint.js, well
 * before this bundle exists (#585 — booting reveals from here meant the hero
 * waited on firebase/auth/analytics init). This module only adopts the running
 * instance so `omega.library().motion.scan(el)` keeps working.
 */
import omega from '@omega.js/client';

// Module
export default () => {
  // Loud, at the break point: first-paint.js always runs before this bundle
  // exists, so a missing instance is a broken build (a dropped asset entry, a
  // head that stopped loading the script). Seating `undefined` would only
  // surface later, as a bare TypeError inside somebody's scan() call.
  if (!window.__omegaMotion) {
    throw new Error('[@omega.js/web:motion] window.__omegaMotion is missing — core/js/first-paint.js never ran');
  }

  // Register on the omega library for programmatic access (omega.library().motion.scan(el))
  omega._library.motion = window.__omegaMotion;

  console.log('Motion module loaded');
};
