/**
 * Product-demo tab behavior — Bootstrap handles the tab switching itself
 * (data-bs-toggle="tab"); this pauses the videos of inactive tabs and
 * restarts the active tab's video for better UX. The §7 presence init calls
 * this once per rendered instance with the section's root element, so the
 * behavior works on ANY page that composes the band (moved here from
 * core/js/pages/index.js, which owned it when only the homepage — and the
 * hero-demo test pages via the dead asset_path override — rendered it).
 */
export default (el) => {
  const $tabButtons = el.querySelectorAll('button[data-bs-toggle="tab"]');

  if (!$tabButtons.length) {
    return;
  }

  // Listen to Bootstrap's tab show event
  $tabButtons.forEach(function($button) {
    $button.addEventListener('shown.bs.tab', function() {
      // Get the target tab pane
      const targetId = this.getAttribute('data-bs-target');
      const $targetPane = document.querySelector(targetId);

      // Pause all videos first
      const $allVideos = el.querySelectorAll('.tab-pane video');
      $allVideos.forEach(function($video) {
        $video.pause();
      });

      // Play the video in the active tab
      if ($targetPane) {
        const $activeVideo = $targetPane.querySelector('video');
        if ($activeVideo) {
          // Reset to beginning and play
          $activeVideo.currentTime = 0;
          $activeVideo.play().catch(function(error) {
            // Autoplay might be blocked by browser, that's okay
            console.log('[Product demo] Autoplay blocked:', error.message);
          });
        }
      }
    });
  });
};
