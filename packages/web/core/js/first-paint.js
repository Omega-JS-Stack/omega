/**
 * First-paint script — the one seam that runs BEFORE the main bundle.
 *
 * Its own asset entry (src/assets.js), loaded from core/head.html as a deferred
 * module, so it executes the moment the DOM is parsed: ahead of the main
 * bundle's module in the foot, and independent of images, fonts and firebase.
 *
 * It exists because of #585: the motion engine used to boot from core/js/main.js
 * behind firebase/auth/analytics init, so every `[data-omega-reveal]` — hidden
 * under the head's `html[data-omega-motion]` stamp — stayed invisible for the
 * whole bundle download. On a cold cache that was seconds of blank hero, with
 * LCP measured on an empty band. Same engine, same CSS transition, same feel;
 * it just starts when the DOM is ready instead of when the app is.
 *
 * KEEP THIS SMALL, and keep it off the client singleton. Importing
 * `@omega.js/client` here would drag the whole runtime into this bundle and
 * rebuild the problem it exists to solve — the motion module's subpath is
 * standalone by design. Anything else that must beat the big bundle (brand
 * custom hero animations, #441, ride this same engine) belongs here, weighed
 * against that budget.
 */
import { createMotion } from '@omega.js/client/modules/motion.js';

const motion = createMotion();

// start() owns its own timing: it scans immediately when the DOM is parsed
// (which, for a deferred module, is now) and defers to DOMContentLoaded if the
// document is somehow still loading. It is idempotent, and a MutationObserver
// picks up anything rendered later.
motion.start();

// Handed to the main bundle's motion module, which registers it on the omega
// library for programmatic access (omega.library().motion.scan(el)). One engine
// per page: the bundle adopts this instance rather than starting a second.
window.__omegaMotion = motion;
