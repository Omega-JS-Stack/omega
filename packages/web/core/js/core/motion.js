/**
 * Motion Module
 * Boots the shared @omega.js/client motion engine (reveals, count-ups, word
 * rotators, marquees, scroll watchers — see core/css/motion/_index.scss for
 * the attribute contract). The html[data-omega-motion] stamp that gates the
 * reveal styles is emitted inline by core/head.html before first paint.
 *
 * Booting is also the moment the CSS safety net stands down (#585): until
 * html[data-omega-motion-ready] lands, every hidden reveal resolves itself a
 * second in, so a cold-cache page is never blank text waiting on this bundle.
 */
import omega from '@omega.js/client';
import { createMotion } from '@omega.js/client/modules/motion.js';

// The net's delay — --omega-reveal-wait's default in core/css/motion/_index.scss.
// One number, two homes; test/reveal-paint.test.js holds them equal.
const REVEAL_WAIT = 1000;

// The lead band's reveal targets — the same selector the sheet's lane 2 uses.
const LEAD_REVEALS = '[data-omega-reveal-lead] > section:first-of-type [data-omega-reveal]';

/**
 * Drop the lead band's `will-change` staging hint once its entrance has played
 * (#585 follow-up). The sheet asks for the compositor layer BEFORE the lead-in
 * delay elapses, so the first frame is not also the frame that builds it — but
 * a hint that outlives its animation is memory reserved for nothing. Waiting on
 * the animation's own `finished` promise means a bundle arriving mid-entrance
 * cannot cut it short, and one arriving after it settled resolves immediately.
 */
const settleLeadReveals = () => {
  document.querySelectorAll(LEAD_REVEALS).forEach(($el) => {
    const drop = () => { $el.style.willChange = 'auto'; };
    // By NAME: the hero's decorative frame also carries .omega-float, whose
    // ambient loop never finishes.
    const entrance = ($el.getAnimations ? $el.getAnimations() : [])
      .filter((animation) => animation.animationName === 'omega-reveal-in');

    if (!entrance.length) {
      drop();
      return;
    }
    Promise.allSettled(entrance.map((animation) => animation.finished)).then(drop);
  });
};

// Module
export default () => {
  const motion = createMotion();

  // Register on the omega library for programmatic access (omega.library().motion.scan(el))
  omega._library.motion = motion;

  const boot = () => {
    // Arriving after the net's window, the page the visitor is READING is
    // already resolved. Adopt it: the ready stamp below drops the net, and
    // without this every one of those elements would snap back to hidden
    // until it scrolled through the observer again.
    if (performance.now() >= REVEAL_WAIT) {
      document.querySelectorAll('[data-omega-reveal]')
        .forEach(($el) => $el.setAttribute('data-omega-inview', 'true'));
    }

    motion.start();

    // The engine has the wheel: the net stands down and below-the-fold
    // reveals go back to waiting for their scroll.
    document.documentElement.setAttribute('data-omega-motion-ready', 'true');

    // …and the lead band's staging hint comes off when its entrance settles.
    settleLeadReveals();
  };

  // start() defers its own scan to DOMContentLoaded while the document is
  // still parsing, and the stamp may not outrun that scan — it would call the
  // net off with nothing yet observing.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  console.log('Motion module loaded');
};
