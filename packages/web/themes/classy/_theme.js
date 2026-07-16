// Import the theme entry point
// __main_assets__ is a build alias that resolves to the framework's core assets
import bootstrap from '__main_assets__/themes/bootstrap/js/index.umd.js';
import { ready as domReady } from '@omega.js/client/modules/dom.js';

// Make Bootstrap available globally
window.bootstrap = bootstrap;

// Log that we've MADE IT
/* @dev-only:start */
{
  console.log('Classy theme loaded successfully (assets/themes/classy/_theme.js)');
}
/* @dev-only:end */

// Nav glassiness, marquees, reveals, count-ups, and rotators all ride the
// shared motion engine (core/js/core/motion.js) — no theme JS needed.

// Import tooltip initialization
import initializeTooltips from './js/initialize-tooltips.js';
// Import hero demo form initialization
import initHeroDemoForm from './js/hero-demo-form.js';

// Initialize theme components when DOM is ready
domReady().then(() => {
  // Generic Bootstrap initializations
  initializeTooltips();

  // Initialize hero demo form if present
  initHeroDemoForm();
});
