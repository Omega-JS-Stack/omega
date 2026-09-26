// The page contexts' runtime: popup, options, sidepanel and page are ONE class,
// told apart by the context name. It extends @omega.js/client's base class, so a
// page carries the client's modules (`auth`, `storage`, `analytics`,
// `bindings`, ...) as properties, plus the extension's context members.

// Libraries
import { Omega as ClientOmega } from '@omega.js/client';
import { contextMembers } from './omega.js';
import { ExtensionAuth } from './lib/extension-auth.js';
import { getVersion } from './utils/mode-helpers.js';
import { syncWithBackground, setupAuthBroadcastListener, setupSignOutListener, setupAuthEventListeners } from './lib/auth-helpers.js';
import { wireAds } from './lib/verts.js';
import { trackAppLaunch } from './lib/analytics.js';

// The theme module (its import exposes Bootstrap to window.bootstrap; the page
// boot calls its default export with this instance)
import theme from '__theme__/_theme.js';

// Icon auto-render (fa-* markup, static or JS-set): the shared client watcher
import './lib/icons.js';

/**
 * One page context's runtime: the @omega.js/client base class, the extension's
 * context members, and an auth that can open the brand site's pages.
 */
class Omega extends ClientOmega {
  /**
   * @param {string} name - the context: popup, options, sidepanel or page.
   */
  constructor(name) {
    super();

    Object.assign(this, contextMembers(name));

    // The extension's version, from the manifest
    this.version = getVersion();

    // The client's Auth plus openPage(): the sign-in round trip starts here
    this.auth = new ExtensionAuth(this);
  }

  /**
   * Boot the client from the page's build snapshot, then the theme module,
   * then the extension's page boot: the launch event, auth sync with
   * background, the auth listeners and triggers, and the vert binding.
   * @returns {Promise<Omega>} the instance.
   */
  async initialize() {
    await super.initialize(window.OMEGA_BUILD_JSON?.config);

    // The theme module boots with this instance, like every other module
    await theme({ omega: this, options: {} });

    // This surface opened: the extension's own launch event (#328 gap 7), for
    // the launch contexts only (lib/analytics.js says which).
    // login/logout ride the shared client's auth wiring.
    trackAppLaunch(this);

    // Set up auth state listener (updates bindings with user/account state)
    this.auth.listen((state) => {
      this.logger.log('Auth state changed:', state);
    });

    // Sync auth with background.js (waits for @omega.js/client auth to settle first)
    await syncWithBackground(this);

    // Set up broadcast listener for sign-in/sign-out from background
    setupAuthBroadcastListener(this);

    // Set up sign-out listener to notify background when user signs out
    setupSignOutListener(this);

    // Set up auth event listeners (sign in, account buttons)
    setupAuthEventListeners(this);

    // Auto-bind [data-omega-vert] elements (house/company lane only, lib/verts.js)
    wireAds(this);

    // Log
    this.logger.log('Initialized!', this);

    return this;
  }
}

export default Omega;
export { Omega };
