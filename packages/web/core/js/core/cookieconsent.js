import webManager from 'web-manager';

// Cookie Consent Module
export default function () {

  // Check if user has already consented
  const hasConsented = webManager.storage().get('cookies.consent.accepted') === true;

  // Get configuration (already normalized with defaults)
  const config = webManager.config.cookieConsent.config;

  // Wait for DOM to be ready
  webManager.dom().ready().then(() => {
    if (hasConsented) {
      // Show minimized button if already consented
      createMinimizedButton(config);
    } else {
      // Show full banner if not consented
      createCookieBanner(config);
      // Track cookie banner shown
      trackCookieBannerShown();
    }
  });

  // Create cookie consent banner
  function createCookieBanner(config) {
    // Create main container
    const banner = document.createElement('div');
    banner.className = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.setAttribute('aria-live', 'polite');

    // Set position classes
    const positionClasses = {
      'bottom-left': 'cookie-consent-bottom-left',
      'bottom-right': 'cookie-consent-bottom-right',
      'bottom': 'cookie-consent-bottom'
    };

    banner.classList.add(positionClasses[config.position] || 'cookie-consent-bottom-left');

    // Set theme class
    banner.classList.add(`cookie-consent-theme-${config.theme}`);

    // Create inner container
    const innerContainer = document.createElement('div');
    innerContainer.className = 'cookie-consent-container';

    // Create message
    const message = document.createElement('div');
    message.className = 'cookie-consent-message';

    // Parse message to replace {terms} placeholder with clickable link
    let messageHTML = config.content.message;

    // Replace {terms} (with or without spaces) with a clickable link to /terms
    messageHTML = messageHTML.replace(
      /\{\s*terms\s*\}/gi,
      `<a href="/terms" class="cookie-consent-link" target="_blank" rel="noopener noreferrer">terms of service</a>`
    );

    message.innerHTML = messageHTML;

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'cookie-consent-buttons';

    // Create dismiss button
    const dismissButton = document.createElement('button');
    dismissButton.className = 'cookie-consent-button cookie-consent-dismiss';
    dismissButton.textContent = config.content.dismiss;
    dismissButton.setAttribute('aria-label', 'Accept cookies');

    // Handle dismiss click
    dismissButton.addEventListener('click', () => {
      acceptCookies(banner);
    });

    // Add deny button if type is opt-in
    if (config.type === 'opt-in') {
      const denyButton = document.createElement('button');
      denyButton.className = 'cookie-consent-button cookie-consent-deny';
      denyButton.textContent = config.content.deny;
      denyButton.setAttribute('aria-label', 'Decline cookies');

      denyButton.addEventListener('click', () => {
        denyCookies(banner);
      });

      buttonContainer.appendChild(denyButton);
    }

    buttonContainer.appendChild(dismissButton);

    // Assemble the banner
    innerContainer.appendChild(message);
    innerContainer.appendChild(buttonContainer);
    banner.appendChild(innerContainer);

    // Apply custom styles
    applyCustomStyles(banner, config);

    // Add to page
    document.body.appendChild(banner);

    // Animate in after a short delay
    setTimeout(() => {
      banner.classList.add('cookie-consent-show');
    }, 100);

    // Auto-accept on user interaction (scroll or click outside banner)
    const autoAcceptHandler = (event) => {
      // If click event, check if it's on the banner or its children
      if (event.type === 'click' && banner.contains(event.target)) {
        return; // Ignore clicks on the banner itself
      }

      // Remove listeners immediately to prevent multiple calls
      window.removeEventListener('scroll', autoAcceptHandler);
      window.removeEventListener('click', autoAcceptHandler);

      // Accept cookies after a small delay to ensure the action feels natural
      setTimeout(() => {
        // Track auto-accept
        trackCookieAutoAccepted(event.type);
        acceptCookies(banner);
      }, 300);
    };

    // Add listeners for auto-accept
    setTimeout(() => {
      window.addEventListener('scroll', autoAcceptHandler, { once: true, passive: true });
      window.addEventListener('click', autoAcceptHandler);
    }, 500); // Small delay to prevent immediate triggering
  }

  function applyCustomStyles(element, config) {
    // Create style element for custom colors
    const styleId = 'cookie-consent-custom-styles';
    let styleElement = document.getElementById(styleId);

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }

    // Generate custom CSS based on config
    const customCSS = `
      .cookie-consent-banner {
        background-color: ${config.palette.popup.background};
        color: ${config.palette.popup.text};
      }

      .cookie-consent-dismiss {
        background-color: ${config.palette.button.background};
        color: ${config.palette.button.text};
      }

      .cookie-consent-dismiss:hover {
        background-color: ${config.palette.button.background};
        color: ${config.palette.button.text};
        opacity: 0.9;
      }

      .cookie-consent-deny {
        background-color: transparent;
        color: ${config.palette.popup.text};
        border: 1px solid ${config.palette.popup.text};
      }

      .cookie-consent-deny:hover {
        background-color: ${config.palette.popup.text};
        color: ${config.palette.popup.background};
      }

      .cookie-consent-link {
        color: ${config.palette.popup.text};
        text-decoration: underline;
      }
    `;

    styleElement.textContent = customCSS;
  }

  function createMinimizedButton(config) {
    // Create minimized tab container
    const button = document.createElement('button');
    button.className = 'cookie-consent-minimized';
    button.setAttribute('aria-label', 'Cookie preferences');
    button.setAttribute('title', 'Cookie preferences');

    // Set position
    const positionClasses = {
      'bottom-left': 'cookie-consent-minimized-bottom-left',
      'bottom-right': 'cookie-consent-minimized-bottom-right',
      'bottom': 'cookie-consent-minimized-bottom-center',
    };

    button.classList.add(positionClasses[config.position] || 'cookie-consent-minimized-bottom-left');

    // Add text and icon
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 6px;">
        <path d="M12 3C7.03 3 3 7.03 3 12C3 16.97 7.03 21 12 21C16.97 21 21 16.97 21 12C21 11.5 20.96 11 20.87 10.5C20.6 10.8 20.21 11 19.76 11C19.03 11 18.43 10.4 18.43 9.67C18.43 9.23 18.62 8.83 18.94 8.54C18.58 5.7 15.94 3.55 12.78 3.06C12.53 3.03 12.27 3 12 3M9.5 6C10.33 6 11 6.67 11 7.5S10.33 9 9.5 9 8 8.33 8 7.5 8.67 6 9.5 6M14.5 8C15.33 8 16 8.67 16 9.5S15.33 11 14.5 11 13 10.33 13 9.5 13.67 8 14.5 8M7.5 11C8.33 11 9 11.67 9 12.5S8.33 14 7.5 14 6 13.33 6 12.5 6.67 11 7.5 11M12.5 13C13.33 13 14 13.67 14 14.5S13.33 16 12.5 16 11 15.33 11 14.5 11.67 13 12.5 13Z"/>
      </svg>
      <span>Cookie Policy</span>
    `;

    // Apply custom styles for minimized button
    const styleId = 'cookie-consent-minimized-styles';
    let styleElement = document.getElementById(styleId);

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }

    styleElement.textContent = `
      .cookie-consent-minimized {
        background-color: ${config.palette.popup.background};
        color: ${config.palette.popup.text};
        border: 1px solid ${config.palette.popup.background};
      }

      .cookie-consent-minimized:hover {
        background-color: ${config.palette.popup.background};
        filter: brightness(1.1);
      }

      .cookie-consent-minimized:focus {
        outline: 2px solid ${config.palette.popup.background};
        outline-offset: 2px;
      }
    `;

    // Handle click to reopen banner
    button.addEventListener('click', () => {
      // Track cookie policy reopened
      trackCookiePolicyReopened();

      // Remove minimized button
      button.remove();

      // Clear consent to show banner again
      webManager.storage().remove('cookies.consent');

      // Recreate cookie banner
      createCookieBanner(config);
    });

    // Add to page
    document.body.appendChild(button);

    // Animate in
    setTimeout(() => {
      button.classList.add('cookie-consent-minimized-show');
    }, 100);
  }

  function acceptCookies(banner) {
    const timestamp = new Date().toISOString();

    // Store consent using webManager storage
    webManager.storage().set('cookies.consent', {
      accepted: true,
      timestamp: timestamp,
      version: config.version || '1.0'
    });

    // Animate out and replace with minimized button
    banner.classList.remove('cookie-consent-show');
    banner.classList.add('cookie-consent-hide');

    setTimeout(() => {
      banner.remove();
      // Show minimized button
      createMinimizedButton(config);
    }, 300);

    // Track cookie acceptance
    trackCookieAccepted();
  }

  function denyCookies(banner) {
    const timestamp = new Date().toISOString();

    // Store denial using webManager storage
    webManager.storage().set('cookies.consent', {
      accepted: false,
      timestamp: timestamp,
      version: config.version || '1.0'
    });

    // Animate out and replace with minimized button
    banner.classList.remove('cookie-consent-show');
    banner.classList.add('cookie-consent-hide');

    setTimeout(() => {
      banner.remove();
      // Show minimized button even after denial
      createMinimizedButton(config);
    }, 300);

    // Track cookie denial
    trackCookieDenied();
  }

  // Tracking functions
  function trackCookieBannerShown() {
    gtag('event', 'cookie_banner_show', {
      event_category: 'consent'
    });
    fbq('trackCustom', 'CookieBannerShow');
    ttq.track('ViewContent', {
      content_id: 'cookie-banner-show',
      content_type: 'product',
      content_name: 'Cookie Banner Show'
    });
  }

  function trackCookieAccepted() {
    gtag('event', 'cookie_consent_accept', {
      event_category: 'consent',
      consent_type: config.type
    });
    fbq('trackCustom', 'CookieConsentAccept');
    ttq.track('ClickButton', {
      content_id: 'cookie-consent-accept',
      content_type: 'product',
      content_name: 'Cookie Consent Accept'
    });
  }

  function trackCookieDenied() {
    gtag('event', 'cookie_consent_deny', {
      event_category: 'consent',
      consent_type: config.type
    });
    fbq('trackCustom', 'CookieConsentDeny');
    ttq.track('ClickButton', {
      content_id: 'cookie-consent-deny',
      content_type: 'product',
      content_name: 'Cookie Consent Deny'
    });
  }

  function trackCookieAutoAccepted(trigger) {
    gtag('event', 'cookie_consent_auto_accept', {
      event_category: 'consent',
      trigger: trigger
    });
    fbq('trackCustom', 'CookieConsentAutoAccept', {
      trigger: trigger
    });
    ttq.track('ViewContent', {
      content_id: 'cookie-consent-auto-accept',
      content_type: 'product',
      content_name: 'Cookie Consent Auto Accept'
    });
  }

  function trackCookiePolicyReopened() {
    gtag('event', 'cookie_policy_reopen', {
      event_category: 'consent'
    });
    fbq('trackCustom', 'CookiePolicyReopen');
    ttq.track('ClickButton', {
      content_id: 'cookie-policy-reopen',
      content_type: 'product',
      content_name: 'Cookie Policy Reopen'
    });
  }
}
