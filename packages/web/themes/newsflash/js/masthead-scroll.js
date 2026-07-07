// Masthead scroll effect for the Newsflash theme.
// Toggles a `.scrolled` class on the sticky masthead once the page is scrolled
// past a threshold; the SCSS turns that into a soft shadow under the bar.
// Threshold is configurable via the data-nf-scroll-threshold attribute on the navbar.
export default function setupMastheadScroll() {
  const $navbar = document.querySelector('.navbar-floating');
  if (!$navbar) {
    return;
  }

  const threshold = parseInt($navbar.dataset.nfScrollThreshold, 10) || 8;

  let ticking = false;
  function update() {
    $navbar.classList.toggle('scrolled', window.scrollY > threshold);
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
