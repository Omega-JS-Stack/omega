// Navbar scroll effect for the Neobrutalism theme.
// Stamps data-omega-scrolled on the floating navbar once the page is scrolled
// past a threshold; the SCSS turns that into a hard offset shadow under the
// bar. The attribute lives in the omega- namespace (the same contract the
// shared motion engine's data-omega-scroll-watch stamps) so the PurgeCSS
// greedy /omega-/ safelist keeps the rule — a bare runtime-toggled class
// would be purged from the production bundle.
// Threshold is configurable via the data-nb-scroll-threshold attribute on the navbar.
export default function setupNavbarScroll() {
  const navbar = document.querySelector('.navbar-floating');
  if (!navbar) {
    return;
  }

  const threshold = parseInt(navbar.dataset.nbScrollThreshold, 10) || 20;

  let ticking = false;
  function update() {
    navbar.setAttribute('data-omega-scrolled', window.scrollY > threshold ? 'true' : 'false');
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  }

  // Initial state + listener
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
}
