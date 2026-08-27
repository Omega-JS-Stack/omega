/**
 * Autosize the gallery's embedded variant frames (#463).
 *
 * The ONE home: the section gallery's entry pages and the component gallery
 * (#549) embed the same frame documents, so they measure them the same way.
 * The frames are same-origin, which is what makes this possible at all — each
 * one's own document reports its height. Measure on load and on resize; a
 * cross-origin src (never ours) throws on contentDocument, and the markup's
 * inline min-height is the fallback, so an unmeasured frame scrolls instead of
 * collapsing.
 *
 * @param {ParentNode} [$root] - the subtree to scan
 * @returns {void}
 */
export default function autosizeShowcaseFrames($root = document) {
  const $frames = [...$root.querySelectorAll('[data-omega-showcase-frame]')];

  const fit = ($frame) => {
    try {
      const height = $frame.contentDocument.documentElement.scrollHeight;
      if (height) $frame.style.height = `${height}px`;
    } catch {
      // opaque document — leave the fallback height alone
    }
  };

  $frames.forEach(($frame) => {
    $frame.addEventListener('load', () => fit($frame));
    // Lazy frames that already loaded (bfcache, cached navigation) fire no
    // load event — measure once now too.
    fit($frame);
  });

  // Re-measure on resize: the frames are full-width, so a narrower viewport
  // reflows their content taller.
  window.addEventListener('resize', () => $frames.forEach(fit));
}
