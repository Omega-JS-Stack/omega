// Authorized Fetch - Wrapper for wonderful-fetch with Firebase Authentication
import fetch from 'wonderful-fetch';
import webManager from 'web-manager';

/**
 * Makes an authorized API request with Firebase token.
 * Automatically extracts usage data from bm-properties response header
 * and updates webManager bindings so data-wm-bind elements stay in sync.
 *
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Request options for wonderful-fetch
 * @returns {Promise} - The response from the API
 */
export async function authorizedFetch(url, options = {}) {
  // Deep clone options to avoid mutating the original
  const requestOptions = JSON.parse(JSON.stringify(options));

  // Get Firebase auth instance and current user
  const { getAuth } = await import('@firebase/auth');
  const auth = getAuth();
  const user = auth.currentUser;

  if (!user) {
    console.warn('authorizedFetch: No authenticated user found. Did we fully wait for auth state to be determined?');
  }

  // Ensure headers object exists
  if (!requestOptions.headers) {
    requestOptions.headers = {};
  }

  // Set the Authorization header with Bearer token if user is logged in
  if (user) {
    const idToken = await user.getIdToken(true);
    requestOptions.headers['Authorization'] = `Bearer ${idToken}`;
  }

  // Override to 'complete' so we can always read response headers
  const callerWantsComplete = requestOptions.output === 'complete';
  requestOptions.output = 'complete';

  // Make the request using wonderful-fetch
  const response = await fetch(url, requestOptions);

  // Sync usage from bm-properties header into bindings
  _syncUsageFromHeaders(response.headers);

  // Return full response if caller requested it, otherwise just the body
  return callerWantsComplete ? response : response.body;
}

/**
 * Sync usage data from bm-properties response header into the top-level
 * `usage` bindings key (same key web-manager seeds on auth settle).
 *
 * Merges fresh usage counters + limits so the structure becomes:
 *   { credits: { monthly: 5, daily: 2, limit: 100 } }
 */
function _syncUsageFromHeaders(headers) {
  const bmProps = headers?.['bm-properties'];
  if (!bmProps?.usage) {
    return;
  }

  const { current, limits } = bmProps.usage;
  if (!current) {
    return;
  }

  // Get existing usage context and merge fresh data
  const existing = webManager.bindings().getContext().usage || {};
  const usage = { ...existing };

  for (const key of Object.keys(current)) {
    usage[key] = {
      ...existing[key],
      ...current[key],
      limit: limits?.[key] || 0,
    };
  }

  webManager.bindings().update({ usage });
}

// Export default
export default authorizedFetch;
