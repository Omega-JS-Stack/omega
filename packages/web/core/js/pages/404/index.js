// Libraries
import omega from '@omega.js/client';
import { event } from '__main_assets__/js/libs/analytics.js';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Set omega
    // Initialize when DOM is ready
    await omega.dom().ready();

    setupPage();

    // Resolve after initialization
    return resolve();
  });
};

// Handle 404 page logic
function setupPage() {
  // Get urls
  const url = new URL(window.location.href);
  const qs404Fixer = url.searchParams.get('404Fixer');

  // Get elements
  const $pageUrl = document.getElementById('page-url');

  // Update visible URL
  if ($pageUrl) {
    $pageUrl.innerText = window.location.href;
  }

  // Count the miss (#328 inventory gap 6: the 404 page tracked nothing at
  // all). Fired BEFORE the trailing-slash fixer redirects, because the path the
  // visitor actually asked for is the one worth reading — the fixer's reload
  // either lands on a real page or reports the corrected path on its own.
  event('page_not_found', {
    path: url.pathname,
  });

  // If pathname ends with trailing slash, remove it and reload
  if (url.pathname.match(/\/$/) && !qs404Fixer) {
    url.pathname = url.pathname.replace(/\/$/, '');
    url.searchParams.set('404Fixer', 'trailing-slash');

    // Log
    console.log(`Redirecting to ${url.toString()}`);

    // Redirect
    setTimeout(function () {
      window.location.href = url.toString();
    }, 1);
  }

  // Report to Sentry
  omega.sentry().captureException(new Error(`404 at ${window.location.href}`));
}
