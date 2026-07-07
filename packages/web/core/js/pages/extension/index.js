/**
 * Extension Page JavaScript
 */

// Libraries
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    setupBrowserDetection();
    setupInstallTracking();

    // Expose test function globally
    window.triggerExtensionInstall = triggerInstall;

    /* @dev-only:start */
    // {
    //   window.triggerExtensionInstall('chrome');
    // }
    /* @dev-only:end */

    // Resolve after initialization
    return resolve();
  });
};

// Configuration
const config = {
  selectors: {
    browserButtons: '.browser-btn',
    browserPanes: '[data-browser]',
    installButtons: '.tab-pane[data-browser] .btn-primary',
  },
};

// Setup browser detection and auto-select
function setupBrowserDetection() {
  const detectedBrowser = webManager.utilities().getBrowser();
  console.log('Detected browser:', detectedBrowser);

  // Listen for tab changes to scroll to download card
  document.querySelectorAll(config.selectors.browserButtons).forEach($tab => {
    $tab.addEventListener('shown.bs.tab', (event) => {
      const browserId = event.target.id.replace('-tab', '');
      scrollToDownloadCard(browserId);
    });
  });

  // Show loading state initially, then switch to detected browser
  // Activate the detected browser tab using Bootstrap's tab API
  const $detectedTab = document.querySelector(`#${detectedBrowser}-tab`);
  if (!$detectedTab) {
    return;
  }

  const tab = new bootstrap.Tab($detectedTab);
  tab.show();
}

// Scroll to the download card for a given browser
function scrollToDownloadCard(browserId) {
  const $downloadCard = document.querySelector(`#${browserId}-pane .card`);
  if (!$downloadCard) {
    return;
  }

  setTimeout(() => {
    $downloadCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

// Setup install button tracking
function setupInstallTracking() {
  const $installButtons = document.querySelectorAll(config.selectors.installButtons);

  $installButtons.forEach($button => {
    $button.addEventListener('click', function() {
      const $browserPane = this.closest('[data-browser]');
      const browserId = $browserPane ? $browserPane.dataset.browser : 'unknown';
      const installUrl = this.getAttribute('href');

      trackInstallClick(browserId, installUrl);
    });
  });
}

// Tracking function
function trackInstallClick(browser, installUrl) {
  console.log('Extension install clicked:', browser, installUrl);

  gtag('event', 'extension_install', {
    browser: browser,
    install_url: installUrl,
  });

  fbq('trackCustom', 'ExtensionInstall', {
    content_name: `${browser} extension`,
    content_category: browser,
    content_type: 'extension',
  });

  ttq.track('Download', {
    content_id: `extension-${browser}`,
    content_type: 'product',
    content_name: `${browser} extension`,
  });
}

// Trigger install for testing (simulates clicking the install button)
function triggerInstall(browser) {
  const browserId = browser || webManager.utilities().getBrowser();
  const $button = document.querySelector(`.tab-pane[data-browser="${browserId}"] .btn-primary`);

  if (!$button) {
    console.error(`No install button found for browser: ${browserId}`);
    return;
  }

  const installUrl = $button.getAttribute('href');

  if (!installUrl) {
    console.error(`No install URL configured for browser: ${browserId}`);
    return;
  }

  // Track the click
  trackInstallClick(browserId, installUrl);

  // Open the extension store in a new tab
  window.open(installUrl, '_blank');
}
