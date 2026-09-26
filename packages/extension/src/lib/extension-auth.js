// The page contexts' auth (popup, options, sidepanel, page): @omega.js/client's
// Auth module plus the one thing only an extension does, opening a page on the
// brand site in a new tab so the sign-in round trip can land back in
// background.js.
import Auth from '@omega.js/client/modules/auth.js';

/**
 * @omega.js/client's Auth, plus `openPage()`. `this.omega` is the page
 * context's `Omega` instance (its `extension`, `logger` and `config`).
 */
class ExtensionAuth extends Auth {
  /**
   * Open a page on the brand site in a new tab, carrying the active tab's id
   * so background.js can restore it after the sign-in.
   * @param {object} [options]
   * @param {string} [options.path] - the path to open (default '/token').
   * @param {string} [options.authReturnUrl] - a return URL for electron/deep links.
   * @returns {void}
   */
  openPage(options = {}) {
    const { extension, logger, config } = this.omega;

    // The /token page lives on the BRAND site (wave-5 F9): background.js
    // watches the same brand.url host for the redirect. Never authDomain:
    // it is an auth concern that must stay free to change independently.
    const brandUrl = config.brand?.url;

    if (!brandUrl) {
      logger.error('No brand.url configured');
      return;
    }

    // Build the URL
    const path = options.path || '/token';
    const authUrl = new URL(path, brandUrl);

    // Add return URL if provided (for electron/deep links)
    if (options.authReturnUrl) {
      authUrl.searchParams.set('authReturnUrl', options.authReturnUrl);
    }

    // Log
    logger.log('Opening auth page:', authUrl.toString());

    // Get current active tab so we can restore it after auth
    extension.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const authSourceTabId = tabs[0]?.id;

      // Add source tab ID to URL so background can restore it
      if (authSourceTabId) {
        authUrl.searchParams.set('authSourceTabId', authSourceTabId);
      }

      // Open in new tab
      extension.tabs.create({ url: authUrl.toString() });
    });
  }
}

export default ExtensionAuth;
export { ExtensionAuth };
