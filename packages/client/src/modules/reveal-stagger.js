/**
 * reveal-stagger: the ONE home of the reveal stagger, the default step and
 * the delay formula a `[data-omega-reveal-stagger]` parent hands its reveals.
 *
 * Two runtimes run it. The motion engine imports it, and @omega.js/web's
 * head.html inlines its SOURCE into the first-paint starter at build time (a
 * fetch there is the wait that starter exists to remove), the way web's build
 * already requires icon-core. So the function is self-contained: it closes over
 * nothing, because the inlined copy has no module scope to close over.
 */

/**
 * Set `--omega-reveal-delay` on every reveal inside a stagger parent: the
 * parent's step (ms, 60 when it names none) times the reveal's index.
 * @param {Element} parent - the `[data-omega-reveal-stagger]` element
 */
function applyStagger(parent) {
  const step = Number(parent.getAttribute('data-omega-reveal-stagger')) || 60;
  parent.querySelectorAll('[data-omega-reveal]').forEach((el, index) => {
    el.style.setProperty('--omega-reveal-delay', `${index * step}ms`);
  });
}

export { applyStagger };
