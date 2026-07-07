// This file is required by /token page to generate custom auth tokens for extensions/apps
// Also handles MCP OAuth flow: user signs in → Firebase ID token sent back to Claude as auth code
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import webManager from 'web-manager';

// Module
export default function () {
  const $status = document.getElementById('token-status');
  const $error = document.getElementById('token-error');
  const $errorMessage = document.getElementById('token-error-message');
  const $spinner = document.getElementById('token-spinner');
  const $actions = document.getElementById('token-actions');
  const $retry = document.getElementById('token-retry');

  // Retry re-runs the whole flow — reloading re-attempts auth + token generation
  if ($retry) {
    $retry.addEventListener('click', () => window.location.reload());
  }

  // Get URL params
  const url = new URL(window.location.href);
  const authReturnUrl = url.searchParams.get('authReturnUrl');
  const mcpRedirectUri = url.searchParams.get('redirect_uri');
  const mcpState = url.searchParams.get('state');
  const isMcp = url.searchParams.get('mcp') === 'true';

  // Handle DOM ready
  webManager.dom().ready()
  .then(async () => {
    // Log
    console.log('[Token] Initialized.', isMcp ? 'MCP OAuth flow' : 'Standard flow', 'authReturnUrl:', authReturnUrl);

    // Validate redirect URLs
    if (authReturnUrl && !webManager.isValidRedirectUrl(authReturnUrl)) {
      showError('Invalid redirect URL');
      return;
    }

    if (isMcp && !mcpRedirectUri) {
      showError('Missing redirect_uri for MCP OAuth flow');
      return;
    }

    // Wait for auth to be ready and get user
    webManager.auth().listen({ once: true }, async (state) => {
      const user = state.user;

      // Should not happen since page requires auth, but just in case
      if (!user) {
        showError('Not authenticated. Please sign in first.');
        return;
      }

      try {
        // MCP OAuth flow: return Firebase ID token as the authorization code
        if (isMcp && mcpRedirectUri) {
          updateStatus('Completing MCP authorization...');

          const idToken = await webManager.auth().getIdToken(true);
          const returnUrl = new URL(mcpRedirectUri);
          returnUrl.searchParams.set('code', idToken);

          if (mcpState) {
            returnUrl.searchParams.set('state', mcpState);
          }

          const redirectUrl = returnUrl.toString();
          console.log('[Token] MCP redirect to:', redirectUrl);

          updateStatus('Redirecting to Claude...');

          setTimeout(() => {
            updateStatus('If you were not redirected, <a href="' + webManager.utilities().escapeHTML(redirectUrl) + '">click here to try again</a>.', true);
          }, 3000);

          window.location.href = redirectUrl;
          return;
        }

        // Standard flow: generate custom token via BEM API
        updateStatus('Generating secure token...');
        const token = await generateCustomToken();

        // Update status
        updateStatus('Token generated successfully!');

        // Handle redirect or URL update
        if (authReturnUrl) {
          // Redirect to return URL with token
          updateStatus('Redirecting...');
          const returnUrl = new URL(authReturnUrl);
          returnUrl.searchParams.set('authToken', token);

          // LEGACY: Add the legacy payload shape for old desktop app deep links
          // TODO: Remove this block when legacy desktop app support is no longer needed
          _legacyTranslateTokenRedirect(returnUrl, token);

          const redirectUrl = returnUrl.toString();
          console.log('[Token] Redirecting to:', redirectUrl);

          // Show retry button after a delay in case the redirect was cancelled (e.g. custom protocol dialog)
          setTimeout(() => {
            updateStatus('If you were not redirected, <a href="' + webManager.utilities().escapeHTML(redirectUrl) + '">click here to try again</a>.', true);
          }, 3000);

          window.location.href = redirectUrl;
        } else {
          // Add token to current URL (for browser extensions)
          // Extension background will detect this and close the tab
          url.searchParams.set('authToken', token);
          window.history.replaceState({}, '', url.toString());
          stopSpinner();
          updateStatus('You can close this tab now.');
        }
      } catch (error) {
        console.error('[Token] Error generating token:', error);
        showError(error.message || 'Failed to generate token. Please try again.');
      }
    });
  });

  // Generate custom token via backend-manager API
  async function generateCustomToken() {
    const serverApiURL = `${webManager.getApiUrl()}/backend-manager/user/token`;

    const response = await authorizedFetch(serverApiURL, {
      method: 'POST',
      timeout: 60000,
      response: 'json',
      tries: 2,
    });

    // Extract token from response
    const token = response?.token;

    if (!token) {
      throw new Error('No token received from server');
    }

    return token;
  }

  // Update status message (rawHtml=true only when caller has pre-escaped the content)
  function updateStatus(message, rawHtml) {
    if (!$status) {
      return;
    }

    const $p = document.createElement('p');
    $p.className = 'text-muted small';

    if (rawHtml) {
      $p.innerHTML = message;
    } else {
      $p.textContent = message;
    }

    $status.innerHTML = '';
    $status.appendChild($p);
  }

  // Show error message + swap the spinner for the retry / go-home actions
  function showError(message) {
    stopSpinner();

    if ($error && $errorMessage) {
      $errorMessage.textContent = message;
      $error.classList.remove('d-none');
    }
    if ($status) {
      $status.classList.add('d-none');
    }
    if ($actions) {
      $actions.classList.remove('d-none');
    }
  }

  // Stop the loading spinner once the flow reaches a terminal state
  function stopSpinner() {
    if ($spinner) {
      $spinner.classList.add('d-none');
    }
  }

  // LEGACY: Add the legacy token shape for desktop app deep links
  // Legacy desktop apps read ?payload={"token":"X"} on custom protocol URLs — ADDED
  // alongside ?authToken=X (never replacing it): old apps read payload and ignore
  // authToken, modern apps (Electron Manager) read authToken and ignore payload.
  // TODO: Remove this function AND its call above when legacy desktop app support is no longer needed
  function _legacyTranslateTokenRedirect(returnUrl, token) {
    if (returnUrl.protocol !== 'http:' && returnUrl.protocol !== 'https:') {
      returnUrl.searchParams.set('payload', JSON.stringify({ token: token }));
    }
  }
}
