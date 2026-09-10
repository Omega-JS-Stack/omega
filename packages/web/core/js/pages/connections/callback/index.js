// Libraries
import omega from '@omega.js/client';
import { WAKEUP_ROUTE } from '@omega.js/client/modules/request.js';
import { siteUrl } from '__main_assets__/js/libs/path-prefix.js';

// Where the callback lands when nothing named a destination
const DEFAULT_LANDING = '/dashboard/account#connections';

// Where THIS connect lands ([#784](https://github.com/Omega-JS-Stack/omega/issues/784)).
// A brand page starts a connect with `returnUrl: location.pathname + location.search + location.hash`,
// the backend carries it through the encrypted state, and `tokenize` answers it —
// the page has no other way of knowing it, since the browser left for the
// provider in between.
let landing = DEFAULT_LANDING;

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Warm the backend before the auth wait below: the visitor is standing on a
    // spinner while this page tokenizes their authorization code against
    // `/omega/user/connections`, and that POST cannot go out until auth settles
    // ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)).
    omega.request(WAKEUP_ROUTE, { wakeup: true });

    await omega.dom().ready();

    // Wait for auth state before handling callback
    // Required because omega.request needs auth.currentUser
    omega.auth().listen({ once: true }, () => {
      handleOAuthCallback();
    });

    return resolve();
  });
};

// Handle OAuth callback
async function handleOAuthCallback() {
  const $provider = document.getElementById('connections-provider');

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const encryptedState = urlParams.get('state');
    const error = urlParams.get('error');
    const errorDescription = urlParams.get('error_description');

    // Check for OAuth errors from provider
    if (error) {
      throw new Error(errorDescription || error || 'OAuth authorization was denied');
    }

    if (!code) {
      throw new Error('Missing authorization code');
    }

    if (!encryptedState) {
      throw new Error('Missing state parameter');
    }

    // Update provider display (we can't read encrypted state, so use generic text)
    $provider.textContent = 'Provider';

    // Build API URL using omega (no need to read from state)
    const apiUrl = `${omega.getApiUrl()}/omega/user/connections`;

    // Send tokenize request with encrypted state
    // Note: tries=1 because auth codes can only be used once
    const response = await omega.request(apiUrl, {
      method: 'POST',
      timeout: 60000,
      tries: 1,
      body: {
        action: 'tokenize',
        code: code,
        encryptedState: encryptedState,
      },
    });

    // Read off the answer BEFORE its outcome is judged, so both exits below
    // offer the same way back
    landing = isSitePath(response?.returnUrl) ? response.returnUrl : DEFAULT_LANDING;

    if (!response.success) {
      throw new Error(response.message || 'Failed to complete authorization');
    }

    showSuccess();

  } catch (error) {
    console.error('OAuth callback error:', error);
    showError(error.message);
  }
}

/**
 * Whether a value is a path on this site — the same rule the backend validated
 * the `returnUrl` with on the authorize leg (its one home is
 * `routes/user/connections/_context.js`), run again here because THIS is the
 * code that navigates: an absolute URL, a protocol-relative `//host`, a
 * backslash (browsers read `/\host` as `//host`), a scheme, or any whitespace
 * on the way to one of those is an off-site destination, and a value off the
 * wire is never trusted with `location`.
 *
 * @param {*} value - The candidate
 * @returns {boolean} True when it is a path on this site
 */
function isSitePath(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && !/\s/.test(value);
}

// Show success state
function showSuccess() {
  const $loading = document.getElementById('connections-loading');
  const $result = document.getElementById('connections-result');
  const $resultSuccess = document.getElementById('result-success');

  $loading.classList.add('d-none');
  $result.classList.remove('d-none');
  $resultSuccess.classList.remove('d-none');

  // Redirect to where this connect came from after delay
  setTimeout(() => {
    window.location.href = siteUrl(landing);
  }, 500);
}

// Show error state
function showError(message) {
  const $loading = document.getElementById('connections-loading');
  const $result = document.getElementById('connections-result');
  const $resultError = document.getElementById('result-error');
  const $errorMessage = document.getElementById('error-message');
  const $returnButton = document.getElementById('return-button');

  $loading.classList.add('d-none');
  $result.classList.remove('d-none');
  $resultError.classList.remove('d-none');

  $errorMessage.textContent = message;

  // The way back is the way in, when the answer named one
  $returnButton.href = siteUrl(landing);
}
