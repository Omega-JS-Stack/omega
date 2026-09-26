/**
 * The web runtime instance: `import omega from '@omega.js/web/runtime'`.
 *
 * @omega.js/client exports the browser runtime as a base class and no
 * instance; this module is web's ONE instance of it, the object every layout,
 * page and section module receives as `{ omega, options }` and every core file
 * imports. The boot runtime (runtime/boot.js) initializes it once per page.
 *
 * It lives in the boot runtime's shared chunk, so every bundle a page loads
 * sees the SAME initialized instance.
 *
 * Web adds its page chrome as properties, set once the client has booted:
 *   omega.appearance  - the dark/light/system switcher (core/js/core/appearance.js)
 *   omega.shell       - the .omega-shell sidebar and drawer (core/js/core/app-shell.js)
 *   omega.motion      - the first-paint motion engine (core/js/core/motion.js)
 *   omega.exitPopup   - `{ show }`, assigned by core/js/main.js when the
 *                       exit popup is enabled, and null otherwise
 */
import { Omega as ClientOmega } from '@omega.js/client';
import { createAppearance } from '../core/js/core/appearance.js';
import { createShell } from '../core/js/core/app-shell.js';
import { adoptMotion } from '../core/js/core/motion.js';

/**
 * The web runtime: the @omega.js/client base class plus web's page chrome.
 */
class Omega extends ClientOmega {
  constructor() {
    super();

    // Web's page chrome, built by initialize()
    this.appearance = null;
    this.shell = null;

    // Assigned by core/js/main.js when `exitPopup.enabled`
    this.exitPopup = null;
  }

  /**
   * Boot the client, then build web's page chrome on the instance.
   * @param {object} configuration - the page's OMEGA_BUILD_JSON.config.
   * @returns {Promise<Omega>} the instance.
   */
  async initialize(configuration) {
    await super.initialize(configuration);

    this.appearance = createAppearance(this);
    this.shell = createShell(this);
    this.motion = adoptMotion();

    return this;
  }
}

const omega = new Omega();

export default omega;
export { Omega };
