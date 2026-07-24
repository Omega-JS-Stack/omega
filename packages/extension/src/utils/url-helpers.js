// Backend URL helpers, shared across BXM's context Managers. Mirrors
// @omega.js/desktop's src/utils/url-helpers.js (the SSOT for this contract) so
// BXM apps hit the same dev/prod backends as EM and UJM consumers — currently
// the getApiUrl subset; add the sibling helpers here when a caller needs them.
//
// `getEnvironment()` is the SINGLE SOURCE OF TRUTH and lives in
// src/utils/mode-helpers.js. getApiUrl() routes through `this.getEnvironment()`
// and resolves to LOCAL urls in BOTH development AND testing — callers normally
// pass NO argument; an explicit `environment` arg is an override (used mainly by
// tests to pin a specific environment's mapping).
//
// Context caveat: browser extension contexts (service worker, popup, …) have no
// `process` — the resolved-port env channel (N7) only exists in build-time Node
// and the test harness, so browser contexts use the classic defaults.

function envPort(name) {
  return typeof process !== 'undefined' && process.env
    ? process.env[name]
    : undefined;
}

function getApiUrl(environment) {
  const env = environment || this.getEnvironment();

  // Local for development OR testing; production otherwise. Mirrors
  // @omega.js/backend's getApiUrl (N7): a published OMEGA_HTTPS_PORT means
  // `mgr serve`'s mkcert proxy is up (https); otherwise plain http to the
  // hosting emulator (resolved port or classic 5002).
  if (env === 'development' || env === 'testing') {
    const httpsPort = envPort('OMEGA_HTTPS_PORT');
    return httpsPort
      ? `https://localhost:${httpsPort}`
      : `http://localhost:${envPort('OMEGA_HOSTING_PORT') || 5002}`;
  }

  // Prod: api.<brand host>. Mirrors @omega.js/client.getApiUrl. Never derive
  // from authDomain — OAuth pins it to <projectId>.firebaseapp.com (site
  // domains don't serve /__/auth/handler), which has no api.* subdomain.
  const brandUrl = this?.config?.brand?.url;
  if (!brandUrl) {
    throw new Error('brand.url not set in config/omega.json5');
  }

  return `https://api.${new URL(brandUrl).hostname}`;
}

// Mix the URL helpers into a Manager constructor's prototype + the constructor
// itself. These call `this.getEnvironment()`, so mode-helpers' attachTo() must
// run before (or alongside) this one.
function attachTo(Manager) {
  Manager.prototype.getApiUrl = getApiUrl;
  Manager.getApiUrl = getApiUrl;
}

module.exports = {
  attachTo,
  getApiUrl,
};
