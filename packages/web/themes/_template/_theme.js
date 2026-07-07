// <Theme Name> — JS entry point
// Loaded at runtime via webpack's __theme__ alias. Exposes Bootstrap globally
// and runs your theme behaviors once the DOM is ready.
import bootstrap from '__main_assets__/themes/bootstrap/js/index.umd.js';
import { ready as domReady } from 'web-manager/modules/dom.js';

// Make Bootstrap available globally (used by UJM utilities + components)
window.bootstrap = bootstrap;

// Initialize theme behaviors when the DOM is ready
domReady().then(() => {
  // Add your theme's initializers here, e.g.:
  // import('./js/navbar-scroll.js').then(m => m.default());
});
