/**
 * Omega API Proxy Worker — DEPRECATED (Ian 2026-07-10, removal planned)
 *
 * Firebase Hosting rewrites serve /omega directly on the api domain, so this
 * Cloudflare hop is unnecessary. Kept only for legacy brands whose
 * cloudflare.workers config still routes through it — drop the entry there
 * and let hosting rewrites take over. Do not add this worker to new brands.
 *
 * What it did: proxies api.{domain}/omega (and the legacy /backend-manager
 * alias) to us-central1-{project-id}.cloudfunctions.net/omega_api.
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
