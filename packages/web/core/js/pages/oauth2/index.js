// Libraries
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    await webManager.dom().ready();

    // Wait for auth state before handling callback
    // Required because authorizedFetch needs auth.currentUser
    webManager.auth().listen({ once: true }, () => {
      handleOAuthCallback();
    });

    return resolve();
  });
};

// Handle OAuth callback
async function handleOAuthCallback() {
  const $provider = document.getElementById('oauth2-provider');

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

    // Build API URL using webManager (no need to read from state)
    const apiUrl = `${webManager.getApiUrl()}/backend-manager/user/oauth2`;

    // Send tokenize request with encrypted state
    // Note: tries=1 because auth codes can only be used once
    const response = await authorizedFetch(apiUrl, {
      method: 'POST',
      timeout: 60000,
      response: 'json',
      tries: 1,
      body: {
        action: 'tokenize',
        code: code,
        encryptedState: encryptedState,
      },
    });

    if (!response.success) {
      throw new Error(response.message || 'Failed to complete authorization');
    }

    showSuccess();

  } catch (error) {
    console.error('OAuth callback error:', error);
    showError(error.message);
  }
}

// Show success state
function showSuccess() {
  const $loading = document.getElementById('oauth2-loading');
  const $result = document.getElementById('oauth2-result');
  const $resultSuccess = document.getElementById('result-success');

  $loading.classList.add('d-none');
  $result.classList.remove('d-none');
  $resultSuccess.classList.remove('d-none');

  // Redirect to account page after delay
  setTimeout(() => {
    window.location.href = '/account#connections';
  }, 500);
}

// Show error state
function showError(message) {
  const $loading = document.getElementById('oauth2-loading');
  const $result = document.getElementById('oauth2-result');
  const $resultError = document.getElementById('result-error');
  const $errorMessage = document.getElementById('error-message');
  const $returnButton = document.getElementById('return-button');

  $loading.classList.add('d-none');
  $result.classList.remove('d-none');
  $resultError.classList.remove('d-none');

  $errorMessage.textContent = message;

  // Default return URL
  $returnButton.href = '/account#connections';
}
