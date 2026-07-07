// Neobrutalism Theme — JS entry point
// Loaded at runtime via webpack's __theme__ alias (import('__theme__/_theme.js')).
// Exposes Bootstrap globally and wires up theme behaviors on DOM ready.
import bootstrap from '__main_assets__/themes/bootstrap/js/index.umd.js';
import { ready as domReady } from 'web-manager/modules/dom.js';

// Make Bootstrap available globally (used by UJM utilities + components)
window.bootstrap = bootstrap;

/* @dev-only:start */
{
  console.log('Neobrutalism theme loaded successfully (assets/themes/neobrutalism/_theme.js)');
}
/* @dev-only:end */

// Theme behaviors
import setupNavbarScroll from './js/navbar-scroll.js';
import initializeTooltips from './js/initialize-tooltips.js';

// Initialize when DOM is ready
domReady().then(() => {
  // Neobrutalism behaviors
  setupNavbarScroll();

  // Generic Bootstrap initializations
  initializeTooltips();
});
