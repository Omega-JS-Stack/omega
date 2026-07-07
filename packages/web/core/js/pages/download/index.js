/**
 * Download Page JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import fetch from 'wonderful-fetch';
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    setupPlatformDetection();
    setupDownloadTracking();
    setupCopyButtons();
    setupMobileEmailForms();
    setupAutoDownload();

    // Expose modal function globally for testing
    window.showDownloadModal = showOnboardingModal;

    /* @dev-only:start */
    // {
    //   window.showDownloadModal('mac');
    // }
    /* @dev-only:end */

    // Resolve after initialization
    return resolve();
  });
};

// Configuration
const config = {
  selectors: {
    platformButtons: '.platform-btn',
    platformDownloads: '[data-platform]',
    downloadButtons: '.tab-pane[data-platform] [data-download]',
  },
};

// Setup platform detection and auto-select
function setupPlatformDetection() {
  const detectedPlatform = webManager.utilities().getPlatform();
  console.log('Detected platform:', detectedPlatform);

  // Listen for tab changes to scroll to download card
  document.querySelectorAll(config.selectors.platformButtons).forEach($tab => {
    $tab.addEventListener('shown.bs.tab', (event) => {
      const platformId = event.target.id.replace('-tab', '');
      scrollToDownloadCard(platformId);
    });
  });

  // Activate the detected platform tab using Bootstrap's tab API
  const $detectedTab = document.querySelector(`#${detectedPlatform}-tab`);
  if (!$detectedTab) {
    return;
  }

  const tab = new bootstrap.Tab($detectedTab);
  tab.show();
}

// Scroll to the download card for a given platform
function scrollToDownloadCard(platformId) {
  const $downloadCard = document.querySelector(`#${platformId}-pane .card`);
  if (!$downloadCard) {
    return;
  }

  setTimeout(() => {
    $downloadCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

// Bootstrap's tab component handles all tab switching automatically via data-bs-toggle="tab"
// No manual switcher needed!

// Setup download button tracking
function setupDownloadTracking() {
  const $downloadButtons = document.querySelectorAll(config.selectors.downloadButtons);

  $downloadButtons.forEach($button => {
    $button.addEventListener('click', function() {
      const $platformPane = this.closest('[data-platform]');
      const platformId = $platformPane ? $platformPane.dataset.platform : 'unknown';
      const downloadName = this.textContent.trim();
      const downloadUrl = this.getAttribute('href');

      trackDownloadClick(platformId, downloadName, downloadUrl);
      showOnboardingModal(platformId);
    });
  });
}

// Slideshow auto-advance interval (ms)
const SLIDESHOW_INTERVAL = 5000;

// Active slideshow timer
let slideshowTimer = null;

// Show onboarding modal with platform-specific instructions
function showOnboardingModal(platform) {
  const $modal = document.getElementById('onboardingModal');
  if (!$modal) {
    console.error('Onboarding modal not found in DOM');
    return;
  }

  const $platformInstructions = $modal.querySelectorAll('.platform-instructions');
  $platformInstructions.forEach($el => {
    if ($el.dataset.platform === platform) {
      $el.removeAttribute('hidden');
    } else {
      $el.setAttribute('hidden', '');
    }
  });

  // Initialize slideshow for the active platform
  const $activeInstructions = $modal.querySelector(`.platform-instructions[data-platform="${platform}"]`);
  const $slideshow = $activeInstructions ? $activeInstructions.querySelector('.steps-slideshow') : null;
  if ($slideshow) {
    initSlideshow($slideshow);
  }

  const modal = new bootstrap.Modal($modal);
  modal.show();

  // Stop auto-advance when modal closes
  $modal.addEventListener('hidden.bs.modal', () => {
    clearInterval(slideshowTimer);
    slideshowTimer = null;
  }, { once: true });
}

// Initialize a slideshow: build dots, show first slide, start auto-advance
function initSlideshow($slideshow) {
  const $slides = $slideshow.querySelectorAll('.step-slide');
  const $dotsContainer = $slideshow.querySelector('.steps-dots');
  const $prevBtn = $slideshow.querySelector('.step-prev');
  const $nextBtn = $slideshow.querySelector('.step-next');
  const totalSteps = $slides.length;

  // Build dots
  $dotsContainer.innerHTML = '';
  for (let i = 0; i < totalSteps; i++) {
    const $dot = document.createElement('button');
    $dot.type = 'button';
    $dot.className = 'step-dot';
    $dot.setAttribute('aria-label', `Step ${i + 1}`);
    $dot.addEventListener('click', () => {
      goToSlide($slideshow, i);
      resetAutoAdvance($slideshow);
    });
    $dotsContainer.appendChild($dot);
  }

  // Show first slide
  goToSlide($slideshow, 0);

  // Nav button handlers
  $prevBtn.addEventListener('click', () => {
    const current = getCurrentSlideIndex($slideshow);
    if (current > 0) {
      goToSlide($slideshow, current - 1);
      resetAutoAdvance($slideshow);
    }
  });

  $nextBtn.addEventListener('click', () => {
    const current = getCurrentSlideIndex($slideshow);
    const $slides = $slideshow.querySelectorAll('.step-slide');
    goToSlide($slideshow, (current + 1) % $slides.length);
    resetAutoAdvance($slideshow);
  });

  // Start auto-advance
  startAutoAdvance($slideshow);
}

// Navigate to a specific slide
function goToSlide($slideshow, index) {
  const $slides = $slideshow.querySelectorAll('.step-slide');
  const $dots = $slideshow.querySelectorAll('.step-dot');
  const $prevBtn = $slideshow.querySelector('.step-prev');

  // Update slides
  $slides.forEach(($slide, i) => {
    $slide.classList.toggle('active', i === index);
  });

  // Update dots
  $dots.forEach(($dot, i) => {
    $dot.classList.toggle('active', i === index);
  });

  // Update nav button states (next always enabled since it loops)
  $prevBtn.disabled = index === 0;

  // Update next button text on last slide
  const $nextBtn = $slideshow.querySelector('.step-next');
  const $nextText = $nextBtn.querySelector('.button-text');
  $nextText.textContent = index === $slides.length - 1 ? 'Restart' : 'Next';
}

// Get current active slide index
function getCurrentSlideIndex($slideshow) {
  const $slides = $slideshow.querySelectorAll('.step-slide');
  for (let i = 0; i < $slides.length; i++) {
    if ($slides[i].classList.contains('active')) {
      return i;
    }
  }
  return 0;
}

// Start auto-advance timer
function startAutoAdvance($slideshow) {
  clearInterval(slideshowTimer);

  slideshowTimer = setInterval(() => {
    const $slides = $slideshow.querySelectorAll('.step-slide');
    const current = getCurrentSlideIndex($slideshow);
    const next = (current + 1) % $slides.length;

    goToSlide($slideshow, next);
  }, SLIDESHOW_INTERVAL);
}

// Reset auto-advance (restart timer after manual interaction)
function resetAutoAdvance($slideshow) {
  startAutoAdvance($slideshow);
}

// Tracking functions
function trackDownloadClick(platform, downloadName, downloadUrl) {
  console.log('Download clicked:', platform, downloadName, downloadUrl);

  gtag('event', 'download', {
    platform: platform,
    download_name: downloadName,
    download_url: downloadUrl,
  });

  fbq('trackCustom', 'Download', {
    content_name: downloadName,
    content_category: platform,
    content_type: 'download',
  });

  ttq.track('Download', {
    content_id: `download-${platform}`,
    content_type: 'product',
    content_name: downloadName,
  });
}

// Setup copy command buttons
function setupCopyButtons() {
  const $copyButtons = document.querySelectorAll('.copy-command-btn');

  $copyButtons.forEach($button => {
    $button.addEventListener('click', async function() {
      const $input = this.closest('.input-group').querySelector('input');

      if (!$input || !$input.value) {
        return;
      }

      try {
        await webManager.utilities().clipboardCopy($input);

        const $text = this.querySelector('.button-text');
        const originalText = $text.textContent;

        $text.textContent = 'Copied!';
        this.classList.remove('btn-outline-adaptive');
        this.classList.add('btn-success');

        setTimeout(() => {
          $text.textContent = originalText;
          this.classList.remove('btn-success');
          this.classList.add('btn-outline-adaptive');
        }, 2000);
      } catch (error) {
        console.error('Failed to copy command:', error);
      }
    });
  });
}

// Setup auto-download when ?auto=true is in the URL
function setupAutoDownload() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('auto') !== 'true') {
    return;
  }

  // Find the first download link in the active platform's tab pane
  const detectedPlatform = webManager.utilities().getPlatform();
  const $pane = document.querySelector(`#${detectedPlatform}-pane`);

  if (!$pane) {
    return;
  }

  const $downloadLink = $pane.querySelector('a.btn-primary');

  if (!$downloadLink) {
    return;
  }

  // Trigger the download and show onboarding modal
  const downloadUrl = $downloadLink.getAttribute('href');
  const downloadName = $downloadLink.textContent.trim();

  trackDownloadClick(detectedPlatform, downloadName, downloadUrl);
  showOnboardingModal(detectedPlatform);

  // Trigger the actual download via a hidden iframe to avoid navigating away
  const $iframe = document.createElement('iframe');
  $iframe.style.display = 'none';
  $iframe.src = downloadUrl;
  document.body.appendChild($iframe);

  // Clean up URL so refreshing doesn't re-trigger
  const url = new URL(window.location);
  url.searchParams.delete('auto');
  window.history.replaceState({}, '', url);
}

// Setup mobile email forms
function setupMobileEmailForms() {
  const $forms = document.querySelectorAll('.mobile-email-form');

  $forms.forEach($form => {
    const platform = $form.dataset.platform;
    const formId = `#mobile-email-form-${platform}`;

    const formManager = new FormManager(formId, {
      allowResubmit: false,
      submittingText: 'Sending...',
      submittedText: 'Email Sent!',
    });

    formManager.on('submit', async ({ data }) => {
      console.log('Mobile email form submitted:', { platform, email: data.email });

      // Get API endpoint
      const apiEndpoint = `${webManager.getApiUrl()}/backend-manager/general/email`;

      // Send request using wonderful-fetch
      await fetch(apiEndpoint, {
        method: 'POST',
        body: {
          id: 'general:download-app-link',
          email: data.email,
        },
        response: 'json',
        timeout: 30000,
      });

      formManager.showSuccess('Success! Please check your email for the download link.');
    });
  });
}
