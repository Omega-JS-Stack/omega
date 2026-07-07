// Libraries
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Set webManager
    // Initialize when DOM is ready
    await webManager.dom().ready();

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
  webManager.sentry().captureException(new Error(`404 at ${window.location.href}`));
}
