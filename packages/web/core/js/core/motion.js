/**
 * Motion Module
 * Adopts the shared @omega.js/client motion engine (reveals, count-ups, word
 * rotators, marquees, scroll watchers; see core/css/motion/_index.scss for
 * the attribute contract) as `omega.motion`.
 *
 * It does NOT start the engine: that happens in core/js/first-paint.js, well
 * before this bundle exists (#585: booting reveals from here meant the hero
 * waited on firebase/auth/analytics init). This module only hands over the
 * running instance so `omega.motion.scan(el)` reaches it.
 */

/**
 * The first-paint motion engine, for `omega.motion`.
 * @returns {object} the running engine first-paint.js started.
 */
export function adoptMotion() {
  // Loud, at the break point: first-paint.js always runs before this bundle
  // exists, so a missing instance is a broken build (a dropped asset entry, a
  // head that stopped loading the script).
  if (!window.__omegaMotion) {
    throw new Error('[@omega.js/web:motion] window.__omegaMotion is missing, core/js/first-paint.js never ran');
  }

  return window.__omegaMotion;
}
