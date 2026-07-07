// Navbar scroll effect for the Neobrutalism theme.
// Toggles a `.scrolled` class on the floating navbar once the page is scrolled
// past a threshold; the SCSS turns that into a hard offset shadow under the bar.
// Threshold is configurable via the data-nb-scroll-threshold attribute on the navbar.
export default function setupNavbarScroll() {
  const navbar = document.querySelector('.navbar-floating');
  if (!navbar) {
    return;
  }

  const threshold = parseInt(navbar.dataset.nbScrollThreshold, 10) || 20;

  let ticking = false;
  function update() {
    navbar.classList.toggle('scrolled', window.scrollY > threshold);
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
