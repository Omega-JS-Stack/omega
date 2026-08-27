/**
 * `orbit` — the reference hero animation's behavior (#441).
 *
 * The animation itself is pure CSS and needs no JS at all; this is the slot's
 * third lane doing its ONE honest job: an offscreen orbit is CPU spent on
 * nothing, so the loops park when the piece scrolls out of view and resume when
 * it comes back. The §7 presence init calls this once per rendered instance
 * with the wrapper element (`data-omega-hero="orbit"`), exactly like a
 * section.js.
 *
 * No observer (an old browser, a headless render) leaves the CSS running, which
 * is the state it ships in.
 */
export default (el) => {
  if (typeof IntersectionObserver !== 'function') {
    return;
  }

  const $animated = el.querySelectorAll('.omega-orbit__ring, .omega-orbit__satellite, .omega-orbit__pulse');

  if (!$animated.length) {
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const state = entry.isIntersecting ? 'running' : 'paused';
      $animated.forEach(($node) => { $node.style.animationPlayState = state; });
    });
  }, { threshold: 0 });

  observer.observe(el);
};
