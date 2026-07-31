/**
 * Omega API Proxy Worker — for domains whose origin is NOT Firebase Hosting.
 *
 * Firebase-hosted api domains don't need this (hosting rewrites serve /omega
 * directly). This worker is for brands that front a DEDICATED backend on the
 * api domain (proxifly's shape: api.{domain} is its own API server) and still
 * need the omega routes to reach the brand's Firebase Functions — the worker
 * carves /omega (and the legacy /backend-manager alias) out at the Cloudflare
 * edge and proxies it to
 * us-central1-{FIREBASE_PROJECT_ID}.cloudfunctions.net/omega_api; everything
 * else passes through to the origin untouched.
 *
 * Attach via edge.providers.cloudflare.workers config, e.g.:
 *   { script: 'omega-api-proxy.js', route: 'api.{ domain }/omega*',
 *     env: { FIREBASE_PROJECT_ID: '…' } }
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
