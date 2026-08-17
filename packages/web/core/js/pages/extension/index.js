/**
 * Extension Page JavaScript
 */

// Libraries
import omega from '@omega.js/client';
import { trackGoogle, trackMeta, trackTikTok } from '__main_assets__/js/libs/analytics.js';

/* @dev-only:start */
// The page's dev control lives in the dev palette, not on window (#234, #342).
// The import is inside the block, so production strips it with the section.
import { registerDevSection } from '__main_assets__/js/core/dev-sections.js';
/* @dev-only:end */

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await omega.dom().ready();

    setupBrowserDetection();
    setupInstallTracking();

    /* @dev-only:start */
    // The install trigger was `window.triggerExtensionInstall(browser)`, a
    // console helper that also shipped to production. The palette is the one
    // home for it now, and it only exists in a dev build.
    if (omega.isDevelopment()) {
      registerDevSection('extension', {
        title: 'Extension',
        buildNode: buildExtensionDevSection,
      });
    }
    /* @dev-only:end */

    // Resolve after initialization
    return resolve();
  });
};

/* @dev-only:start */
/**
 * The palette's Extension section: pick one of the browsers the page lists and
 * fire its install click, tracking and all — the same path the real button
 * takes, without hunting for the card.
 */
function buildExtensionDevSection(doc) {
  const wrap = doc.createElement('div');
  wrap.className = 'omega-devbar__fields';

  const select = doc.createElement('select');
  select.className = 'omega-devbar__select';
  select.setAttribute('aria-label', 'Install browser');
  document.querySelectorAll(config.selectors.browserCards).forEach(($card) => {
    const option = doc.createElement('option');
    option.value = $card.dataset.browser;
    option.textContent = $card.dataset.browser;
    select.appendChild(option);
  });

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'omega-devbar__btn';
  button.textContent = 'Trigger install';
  button.addEventListener('click', () => triggerInstall(select.value));

  wrap.append(select, button);

  return wrap;
}
/* @dev-only:end */

// Configuration
const config = {
  selectors: {
    browserCards: '[data-download-card][data-browser]',
    installButtons: '[data-download-card][data-browser] a[data-install]',
  },
};

// Browser detection → the hero button becomes YOUR store button: label,
// href, and browser mark come from the detected browser's card. No card or
// no store listing → the "See supported browsers" fallback stays.
function setupBrowserDetection() {
  const detectedBrowser = omega.utilities().getBrowser();
  console.log('Detected browser:', detectedBrowser);

  const $hero = document.getElementById('extension-hero');
  const $fallback = document.getElementById('extension-hero-fallback');
  if (!$hero || !$fallback) {
    return;
  }

  const $card = document.querySelector(`[data-download-card][data-browser="${detectedBrowser}"]`);
  const $link = $card ? $card.querySelector('a[data-install]') : null;
  if (!$link) {
    return;
  }

  $hero.href = $link.getAttribute('href');
  $hero.target = '_blank';
  $hero.rel = 'noopener';
  $hero.querySelector('[data-hero-label]').textContent = $link.textContent.trim();
  const $mark = $card.querySelector('.omega-dl-card__mark svg');
  if ($mark) {
    $hero.querySelector('[data-hero-icon]').innerHTML = $mark.outerHTML;
  }

  $hero.addEventListener('click', () => {
    trackInstallClick(detectedBrowser, $hero.href);
  });

  $fallback.setAttribute('hidden', '');
  $hero.removeAttribute('hidden');
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

  trackGoogle('event', 'extension_install', {
    browser: browser,
    install_url: installUrl,
  });

  trackMeta('trackCustom', 'ExtensionInstall', {
    content_name: `${browser} extension`,
    content_category: browser,
    content_type: 'extension',
  });

  trackTikTok('Download', {
    content_id: `extension-${browser}`,
    content_type: 'product',
    content_name: `${browser} extension`,
  });
}

// Trigger install for testing (simulates clicking the install button)
function triggerInstall(browser) {
  const browserId = browser || omega.utilities().getBrowser();
  const $button = document.querySelector(`[data-download-card][data-browser="${browserId}"] a[data-install]`);

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
