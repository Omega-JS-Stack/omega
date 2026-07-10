/**
 * Brand-backend calls made AS a managed user — password verification plus
 * the two @omega.js/backend endpoints the account service drives after auth changes:
 * POST /user/signup (completes the signup flow: welcome email, marketing
 * lists, contact inference) and PUT /marketing/contact (pushes the contact
 * to every marketing provider in one call).
 *
 * Auth model: mint a custom token with the Admin credentials, exchange it
 * for an ID token at the public Firebase Auth REST API (needs the web
 * apiKey from firebase state), then call the backend as that user. Methods
 * throw on failure; the handler downgrades failures to warnings because
 * the backend may simply not be deployed yet on a fresh brand.
 */
const AUTH_API_BASE = 'https://identitytoolkit.googleapis.com/v1';

/**
 * Create the backend client.
 *
 * @param {Object} deps
 * @param {Object} deps.authAdmin - Auth admin client (for custom tokens)
 * @param {string|null} deps.apiKey - Firebase web API key (null → verify
 *   always false, signup/sync throw)
 * @param {string} deps.apiBaseUrl - e.g. 'https://api.mybrand.com'
 * @returns {Object} { verifyPassword, signup, syncMarketingContact }
 */
function createBackendClient({ authAdmin, apiKey, apiBaseUrl }) {
  /**
   * Exchange a custom token for an ID token.
   */
  async function getIdToken(uid) {
    const customToken = await authAdmin.createCustomToken(uid);

    const response = await fetch(
      `${AUTH_API_BASE}/accounts:signInWithCustomToken?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!response.ok) {
      throw new Error(`Token exchange failed (${response.status})`);
    }

    const { idToken } = await response.json();
    return idToken;
  }

  async function callBackend(method, path, uid) {
    const idToken = await getIdToken(uid);

    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ uid }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`${method} ${path} failed (${response.status})`);
    }
  }

  return {
    /**
     * True when the password signs in successfully (non-mutating check).
     */
    async verifyPassword(email, password) {
      if (!apiKey) {
        return false;
      }

      try {
        const response = await fetch(
          `${AUTH_API_BASE}/accounts:signInWithPassword?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: false }),
            signal: AbortSignal.timeout(30000),
          },
        );

        return response.ok;
      } catch {
        return false;
      }
    },

    /** Complete the signup flow for a freshly created user. */
    signup(uid) {
      return callBackend('POST', '/omega/user/signup', uid);
    },

    /** Push the user's contact data to all marketing providers. */
    syncMarketingContact(uid) {
      return callBackend('PUT', '/omega/marketing/contact', uid);
    },
  };
}

module.exports = { createBackendClient };
