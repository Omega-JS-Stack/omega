// Page Loader Module - Handles page loading state indicator

// How long to wait for a frame before clearing the state without one
const FRAMELESS_CLEAR_DELAY = 100;

export default function () {
  let removed = false;

  // Log
  console.log('Running complete()');

  // Remove page loading state indicator
  const removeLoadingState = (source) => {
    // Check if already removed
    if (removed) return;
    removed = true;

    // Log
    console.log(`Removing page loading state (source: ${source})`);

    let cleared = false;

    const clear = () => {
      // Whichever of the two came first already did this
      if (cleared) return;
      cleared = true;

      document.documentElement.removeAttribute('data-page-loading');
      document.documentElement.setAttribute('aria-busy', 'false');
    };

    // Use requestAnimationFrame for smooth transition: on a drawing renderer
    // the frame is what clears the state, at the next paint
    requestAnimationFrame(clear);

    // The timer only rescues a renderer that produces no frames at all
    // (headless Chrome on a sleeping display), where the page is done and
    // nothing else would ever clear the state (#803)
    setTimeout(clear, FRAMELESS_CLEAR_DELAY);
  };

  // Check document ready state
  console.log('Document readyState:', document.readyState);

  // For interactive state, we need to wait a bit for resources
  // Since window.load is unreliable with async scripts, use a hybrid approach

  // Immediately remove if already complete
  if (document.readyState === 'complete') {
    removeLoadingState('Complete');
    return;
  }

  // Strategy 1: Try window load event (might not fire)
  window.addEventListener('load', () => {
    removeLoadingState('Load');
  }, { once: true });

  // Strategy 2: Poll for complete state
  const pollInterval = setInterval(() => {
    if (document.readyState === 'complete') {
      clearInterval(pollInterval);
      removeLoadingState('Polling');
    }
  }, 50);

  // Strategy 3: Timeout fallback (max 3 seconds)
  setTimeout(() => {
    clearInterval(pollInterval);
    removeLoadingState('Timeout');
  }, 3000);
}
