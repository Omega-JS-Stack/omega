// Newsflash Theme — Blog post page JS (the #theme layer)
// Drives the reading-progress bar: fills the fixed top rule as the reader
// scrolls through the page. NOTE: flat file shape — the post layout sets
// `asset_path: blog/post`, so this loads as pages/blog/post.js.
export default ({ manager, options }) => {
  const $bar = document.querySelector('.reading-progress > span');
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
