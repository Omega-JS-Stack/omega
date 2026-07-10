/**
 * Omega API Proxy Worker
 *
 * This worker proxies requests from api.{domain}/omega to Firebase Functions.
 * The legacy /backend-manager prefix is accepted as an alias so migrating
 * brands' in-the-wild clients keep working.
 *
 * Configuration:
 * - Route: api.{domain}/omega* (+ api.{domain}/backend-manager* for the alias)
 * - Firebase Function: us-central1-{project-id}.cloudfunctions.net/omega_api
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Get Firebase project ID from environment variable
    const firebaseProjectId = env.FIREBASE_PROJECT_ID;

    // Check if path starts with /omega or the legacy /backend-manager alias
    const prefix = ['/omega', '/backend-manager'].find((p) => url.pathname.startsWith(p));
    if (prefix) {
      // Build Firebase URL, removing the matched prefix
      const firebasePath = url.pathname.replace(prefix, '') || '/';
      const firebaseUrl = `https://us-central1-${firebaseProjectId}.cloudfunctions.net/omega_api${firebasePath}${url.search}`;

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
