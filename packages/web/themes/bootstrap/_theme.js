// A theme module: the host calls the default export with { omega, options }.
import bootstrap from './js/index.umd.js';

// Make Bootstrap available globally
window.bootstrap = bootstrap;

// Log that we've MADE IT
/* @dev-only:start */
{
  console.log('Bootstrap theme loaded successfully (assets/themes/bootstrap/_theme.js)');
}
/* @dev-only:end */

// Add any custom code here
export default async function ({ omega, options }) {}

