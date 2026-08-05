// Newsflash Theme — Blog post page JS (the #theme layer)
// Drives the reading-progress bar: fills the fixed top rule as the reader
// scrolls through the page. NOTE: [slug] wildcard filename (spec §7) — the
// key blog/[slug] serves every /blog/<slug> post page, no frontmatter.
export default () => {
  const $bar = document.querySelector('.newsflash-progress > span');
  if (!$bar) {
    return;
  }

  let ticking = false;
  function update() {
    const $doc = document.documentElement;
    const progress = $doc.scrollTop / ($doc.scrollHeight - $doc.clientHeight);
    $bar.style.transform = `scaleX(${Math.min(Math.max(progress, 0), 1)})`;
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
};
