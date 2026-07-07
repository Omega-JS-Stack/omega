/**
 * Backend Manager Proxy Worker
 *
 * This worker proxies requests from api.{domain}/backend-manager to Firebase Functions.
 *
 * Configuration:
 * - Route: api.{domain}/backend-manager*
 * - Firebase Function: us-central1-{project-id}.cloudfunctions.net/bm_api
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Get Firebase project ID from environment variable
    const firebaseProjectId = env.FIREBASE_PROJECT_ID;

    // Check if path starts with /backend-manager
    if (url.pathname.startsWith('/backend-manager')) {
      // Build Firebase URL, removing /backend-manager prefix
      const firebasePath = url.pathname.replace('/backend-manager', '') || '/';
      const firebaseUrl = `https://us-central1-${firebaseProjectId}.cloudfunctions.net/bm_api${firebasePath}${url.search}`;

      // Proxy the request
      return fetch(firebaseUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    }

    // Pass everything else through
    return fetch(request);
  }
};
