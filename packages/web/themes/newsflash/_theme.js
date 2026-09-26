// Newsflash Theme: JS entry point. A theme module: the host calls the default export with { omega, options }.
import bootstrap from '__main_assets__/themes/bootstrap/js/index.umd.js';
import { ready as domReady } from '@omega.js/client/modules/dom.js';

// Make Bootstrap available globally (used by omega utilities + components)
window.bootstrap = bootstrap;

/* @dev-only:start */
{
  console.log('Newsflash theme loaded successfully (assets/themes/newsflash/_theme.js)');
}
/* @dev-only:end */

// Theme behaviors (masthead scroll state rides the shared motion engine's
// data-omega-scroll-watch, no theme JS)
import initializeTooltips from '__main_assets__/js/libs/initialize-tooltips.js';

// Initialize when DOM is ready
export default async function ({ omega, options }) {
  await domReady();

  // Generic Bootstrap initializations
  initializeTooltips();
}
