// Libraries
import merge from 'lodash/merge.js';
import webManager from 'web-manager';

// Exit Popup Module
export default function () {

  // Get config
  const config = webManager.config.exitPopup.config;

  // Storage key for tracking last shown time
  const STORAGE_KEY = 'exitPopup.timestamp';

  // Check if we should show the popup based on timeout
  const lastShown = webManager.storage().get(STORAGE_KEY, 0);
  const now = Date.now();
  const timeSinceLastShown = now - lastShown;

  // Determine if we should show the popup
  let shouldShow = timeSinceLastShown >= config.timeout;

  // Wait for DOM to be ready
  webManager.dom().ready().then(() => {
    // Setup exit intent detection without needing the element yet
    setupExitIntentDetection();
  });

  // Register showExitPopup on the UJ library for programmatic access
  // Usage: webManager.uj().showExitPopup()

  webManager._ujLibrary.showExitPopup = showExitPopup;

  function updateModalContent($modal, effectiveConfig) {
    // Update title
    const $title = $modal.querySelector('.modal-exit-title');
    if ($title && effectiveConfig.title) {
      $title.textContent = effectiveConfig.title;
    }

    // Update main message
    const $message = $modal.querySelector('.modal-exit-message');
    if ($message && effectiveConfig.message) {
      $message.textContent = effectiveConfig.message;
    }

    // Update offer title
    const $offerTitleText = $modal.querySelector('.modal-exit-offer-title-text');
    if ($offerTitleText && effectiveConfig.offerTitle) {
      $offerTitleText.textContent = effectiveConfig.offerTitle;
    }

    // Update offer description
    const $offerDesc = $modal.querySelector('.modal-exit-offer-description');
    if ($offerDesc && effectiveConfig.offerDescription) {
      $offerDesc.textContent = effectiveConfig.offerDescription;
    }

    // Update main button
    const $button = $modal.querySelector('.modal-exit-button');
    const $buttonText = $modal.querySelector('.modal-exit-button-text');
    if ($button && effectiveConfig.okButton) {
      if ($buttonText && effectiveConfig.okButton.text) {
        $buttonText.textContent = effectiveConfig.okButton.text;
      }
      if (effectiveConfig.okButton.link) {
        // Add ITM parameters to track exit popup conversions
        const url = new URL(effectiveConfig.okButton.link, window.location.origin);
        url.searchParams.set('itm_source', 'website');
        url.searchParams.set('itm_medium', 'modal');
        url.searchParams.set('itm_campaign', 'exit-popup');
        url.searchParams.set('itm_content', window.location.pathname);
        $button.href = url.toString();

        // Remove data-bs-dismiss so the link navigation works properly
        $button.removeAttribute('data-bs-dismiss');
      }
    }

    // Update "Maybe later" link text if configured
    const $dismissLink = $modal.querySelector('.modal-exit-dismiss');
    if ($dismissLink && effectiveConfig.dismissText) {
      $dismissLink.textContent = effectiveConfig.dismissText;
    }

    // Remove hidden attribute to make modal available
    $modal.removeAttribute('hidden');
  }

  function setupExitIntentDetection() {
    // 1. Mouse leave detection (desktop) - leaving from the top
    document.addEventListener('mouseleave', (e) => {
      /* @dev-only:start */
      // {
      //   console.log('Mouse leave detected:', shouldShow, e.clientY);
      // }
      /* @dev-only:end */

      // Only trigger if mouse is leaving from the top (Y <= 0)
      if (shouldShow && e.clientY <= 0) {
        showExitPopup();
      }
    });

    // 2. Window blur detection - user switches tabs or clicks outside browser
    window.addEventListener('blur', () => {
      /* @dev-only:start */
      // {
      //   console.log('Window blur detected:', shouldShow);
      // }
      /* @dev-only:end */

      if (shouldShow) {
        showExitPopup();
      }
    });

    // // 3. Back button detection - user attempts to navigate back
    // // Push a dummy state so we can detect when user tries to go back
    // history.pushState({ exitPopup: true }, '');
    // window.addEventListener('popstate', () => {
    //   /* @dev-only:start */
    //   // {
    //   //   console.log('Popstate detected:', shouldShow);
    //   // }
    //   /* @dev-only:end */

    //   if (shouldShow) {
    //     // Re-push state to prevent actual navigation
    //     history.pushState({ exitPopup: true }, '');
    //     showExitPopup();
    //   }
    // });

    // // 4. Mobile exit intent - rapid scroll up toward the top of the page
    // let lastScrollY = window.scrollY;
    // let scrollVelocity = 0;
    // let lastScrollTime = Date.now();

    // window.addEventListener('scroll', () => {
    //   const now = Date.now();
    //   const deltaTime = now - lastScrollTime;
    //   const deltaY = lastScrollY - window.scrollY; // Positive = scrolling up

    //   // Calculate velocity (pixels per ms)
    //   scrollVelocity = deltaTime > 0 ? deltaY / deltaTime : 0;

    //   /* @dev-only:start */
    //   // {
    //   //   if (scrollVelocity > 1) {
    //   //     console.log('Scroll velocity:', scrollVelocity, 'scrollY:', window.scrollY);
    //   //   }
    //   // }
    //   /* @dev-only:end */

    //   // Trigger if:
    //   // - Scrolling up rapidly (velocity > 2 pixels/ms)
    //   // - Near the top of the page (within 100px)
    //   // - Should show popup
    //   if (shouldShow && scrollVelocity > 2 && window.scrollY < 100) {
    //     showExitPopup();
    //   }

    //   lastScrollY = window.scrollY;
    //   lastScrollTime = now;
    // }, { passive: true });
  }

  function showExitPopup(overrides) {
    // Check if any modal is already open - don't stack modals
    if (document.querySelector('.modal.show')) {
      return;
    }

    // Deep merge overrides with config (without mutating original)
    const effectiveConfig = merge({}, config, overrides);

    /* @dev-only:start */
    {
      console.log('Showing exit popup:', effectiveConfig.title, 'after', timeSinceLastShown, 'ms since last shown');
    }
    /* @dev-only:end */

    // Mark as shown for this session
    shouldShow = false;

    // Store timestamp in storage
    webManager.storage().set(STORAGE_KEY, Date.now());

    // Find the modal element only when needed
    const $modalElement = document.getElementById('modal-exit-popup');
    if (!$modalElement) {
      webManager.sentry().captureException(new Error('Exit popup modal element not found'));
      return;
    }

    // Update modal content with effectiveConfig
    updateModalContent($modalElement, effectiveConfig);

    // Check if Bootstrap is available
    if (!window.bootstrap || !window.bootstrap.Modal) {
      webManager.sentry().captureException(new Error('Bootstrap Modal not available for exit popup'));
      return;
    }

    // Initialize Bootstrap modal instance only when needed
    let modal;
    try {
      modal = new window.bootstrap.Modal($modalElement);
    } catch (error) {
      webManager.sentry().captureException(new Error('Error initializing Bootstrap modal for exit popup', { cause: error }));
      return;
    }

    // Show the modal using Bootstrap
    try {
      modal.show();

      // Add fade class after modal is shown to avoid conflicts with animation-slide-up
      $modalElement.addEventListener('shown.bs.modal', () => {
        $modalElement.classList.add('fade');
      }, { once: true });

      // Track exit popup shown
      trackExitPopupShown();

      // Track button clicks on the exit popup (main CTA button)
      const $button = $modalElement.querySelector('.modal-exit-button');
      if ($button && !$button.hasAttribute('data-exit-popup-tracked')) {
        $button.setAttribute('data-exit-popup-tracked', 'true');
        $button.addEventListener('click', () => {
          trackExitPopupClick();
        });
      }

      // Remove focus from any focused element before hiding to prevent aria-hidden warning
      $modalElement.addEventListener('hide.bs.modal', () => {
        if (document.activeElement && $modalElement.contains(document.activeElement)) {
          document.activeElement.blur();
        }
      }, { once: true });

      // Track modal dismiss
      $modalElement.addEventListener('hidden.bs.modal', () => {
        trackExitPopupDismissed();
      }, { once: true });
    } catch (error) {
      webManager.sentry().captureException(new Error('Error showing exit popup', { cause: error }));
    }
  }

  // Tracking functions
  function trackExitPopupShown() {
    gtag('event', 'exit_popup_show', {
      event_category: 'engagement',
      event_label: config.title,
      page_path: window.location.pathname
    });

    fbq('trackCustom', 'ExitPopupShow', {
      content_name: 'Exit Popup Show',
      page_path: window.location.pathname
    });

    ttq.track('ViewContent', {
      content_id: 'exit-popup-show',
      content_type: 'product',
      content_name: 'Exit Popup Show'
    });
  }

  function trackExitPopupClick() {
    gtag('event', 'exit_popup_click', {
      event_category: 'engagement',
      event_label: config.okButton?.text || 'OK',
      destination_url: config.okButton?.link
    });

    fbq('track', 'Lead', {
      content_name: 'Exit Popup Click',
      content_category: config.title
    });

    ttq.track('ClickButton', {
      content_id: 'exit-popup-click',
      content_type: 'product',
      content_name: 'Exit Popup Click'
    });
  }

  function trackExitPopupDismissed() {
    gtag('event', 'exit_popup_dismiss', {
      event_category: 'engagement',
      event_label: config.title
    });

    fbq('trackCustom', 'ExitPopupDismiss', {
      content_name: 'Exit Popup Dismiss'
    });

    ttq.track('ViewContent', {
      content_id: 'exit-popup-dismiss',
      content_type: 'product',
      content_name: 'Exit Popup Dismiss'
    });
  }
};
