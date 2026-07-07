/**
 * Homepage JavaScript
 */

// Libraries
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    // Bootstrap tabs handle all the tab switching automatically via data-bs-toggle="tab"
    // We just need to pause videos when switching tabs for better UX
    setupVideoControls();

    // Resolve after initialization
    return resolve();
  });
};

/**
 * Setup video controls to pause/play when switching tabs
 */
function setupVideoControls() {
  const $tabButtons = document.querySelectorAll('button[data-bs-toggle="tab"]');

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
      const $allVideos = document.querySelectorAll('.tab-pane video');
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
            console.log('[Homepage] Autoplay blocked:', error.message);
          });
        }
      }
    });
  });
}
