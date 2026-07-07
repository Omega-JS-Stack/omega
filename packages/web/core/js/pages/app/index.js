// Libraries
import webManager from 'web-manager';

// Global variables
let launchTimeout;
let errorTimeout;

// Elements
let $launchButton;
let $downloadButton;
let $errorAlert;
let $spinner;

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

// Initialize app page
function setupPage() {
  // Get elements and URL parameters
  $launchButton = document.getElementById('launch-button');
  $downloadButton = document.getElementById('download-button');
  $errorAlert = document.getElementById('error-alert');
  $spinner = document.querySelector('.spinner-border');

  // Hide spinner initially (will be shown again on launch)
  $spinner.setAttribute('hidden', true);

  // Build deep link URL
  const appUrl = buildDeepLinkUrl();
  $launchButton.setAttribute('href', appUrl);

  // Launch app immediately on page load
  launchApp(appUrl);

  // Handle launch button click
  $launchButton.addEventListener('click', (event) => {
    event.preventDefault();
    launchApp(appUrl);
  });
}

// Build deep link URL with path extraction and query passthrough
function buildDeepLinkUrl() {
  const baseUrl = $launchButton.getAttribute('href'); // e.g., "myapp://"
  const urlParams = new URLSearchParams(window.location.search);

  // Define the special parameter name for the app path
  const PATH_PARAM_NAMES = ['path']

  // Find which path parameter is being used (if any)
  let appPath = '';
  let pathParamUsed = null;

  for (const paramName of PATH_PARAM_NAMES) {
    const value = urlParams.get(paramName);
    if (value !== null) {
      appPath = value;
      pathParamUsed = paramName;
      break;
    }
  }

  // Build the query string for the deep link
  // This includes all parameters EXCEPT the special path parameter
  const deepLinkParams = new URLSearchParams();

  for (const [key, value] of urlParams.entries()) {
    // Skip the special path parameter
    if (!PATH_PARAM_NAMES.includes(key)) {
      deepLinkParams.append(key, value);
    }
  }

  // Construct the final deep link URL
  // Remove leading slash from path if present to avoid double slashes
  const cleanPath = appPath.startsWith('/') ? appPath.substring(1) : appPath;

  // Build the final URL
  let finalUrl = baseUrl;
  if (cleanPath) {
    finalUrl += cleanPath;
  }

  // Add query parameters if there are any
  const queryString = deepLinkParams.toString();
  if (queryString) {
    // Add ? or & depending on whether the path already has query params
    const separator = cleanPath.includes('?') ? '&' : '?';
    finalUrl += separator + queryString;
  }

  console.log('Deep link constructed:', {
    baseUrl: baseUrl,
    pathParam: pathParamUsed,
    appPath: appPath,
    passedParams: queryString,
    finalUrl: finalUrl
  });

  return finalUrl;
}

function launchApp(appUrl) {
  // Show spinner when attempting to launch
  $spinner.removeAttribute('hidden');

  // Clear any previous error timeout and hide error alert
  clearTimeout(errorTimeout);
  $errorAlert.setAttribute('hidden', true);

  // Attempt to launch app
  window.location.href = appUrl;

  // Check if deep link failed after a delay
  // Since browser prompts don't trigger blur, we can't reliably detect if app launched
  // We'll show download options after a delay - user can dismiss if app actually launched
  errorTimeout = setTimeout(() => {
    // Hide spinner
    $spinner.setAttribute('hidden', true);

    // Show download options
    $errorAlert.removeAttribute('hidden');
  }, 2000);
}
