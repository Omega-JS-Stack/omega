// Neobrutalism Theme — JS entry point
// Loaded at runtime via webpack's __theme__ alias (import('__theme__/_theme.js')).
// Exposes Bootstrap globally and wires up theme behaviors on DOM ready.
import bootstrap from '__main_assets__/themes/bootstrap/js/index.umd.js';
import { ready as domReady } from '@omega.js/client/modules/dom.js';

// Make Bootstrap available globally (used by omega utilities + components)
window.bootstrap = bootstrap;

/* @dev-only:start */
{
  console.log('Neobrutalism theme loaded successfully (assets/themes/neobrutalism/_theme.js)');
}
/* @dev-only:end */

// Theme behaviors (navbar scroll state rides the shared motion engine's
// data-omega-scroll-watch on the base nav include; no theme JS)
import initializeTooltips from '__main_assets__/js/libs/initialize-tooltips.js';

// Initialize when DOM is ready
domReady().then(() => {
  // Generic Bootstrap initializations
  initializeTooltips();
});
