// <Theme Name>: JS entry point. A theme module: the host calls the default export with { omega, options }.
import bootstrap from '__main_assets__/themes/bootstrap/js/index.umd.js';
import { ready as domReady } from '@omega.js/client/modules/dom.js';

// Make Bootstrap available globally (used by omega utilities + components)
window.bootstrap = bootstrap;

// Initialize theme behaviors when the DOM is ready
export default async function ({ omega, options }) {
  await domReady();

  // Add your theme's initializers here, e.g.:
  // await import('./js/navbar-scroll.js').then((m) => m.default(omega));
}
