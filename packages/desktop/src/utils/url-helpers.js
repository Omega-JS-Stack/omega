// Backend URL helpers, shared across all Manager contexts (main / renderer / preload /
// build). Mirror web-manager's contract so @omegajs/desktop apps can hit the same dev/prod backends as
// UJM and BXM consumers.
//
// `getEnvironment()` is the SINGLE SOURCE OF TRUTH and lives in src/utils/mode-helpers.js
// (alongside the is*() family; mirrors BEM/UJM/BXM). It returns exactly ONE of
// 'development' | 'testing' | 'production' (mutually exclusive; testing wins).
//
// `getFunctionsUrl()` / `getApiUrl()` / `getWebsiteUrl()` route through
// `this.getEnvironment()` and resolve to LOCAL urls in BOTH development AND testing —
// callers normally pass NO argument. An explicit `environment` arg is an override
// (used mainly by tests to pin a specific environment's mapping).

function getFunctionsUrl(environment) {
  const env = environment || this.getEnvironment();
  const projectId = this?.config?.firebaseConfig?.projectId;

  if (!projectId) {
    throw new Error('firebaseConfig.projectId not set in config/omega.json5');
  }

  // Local for development OR testing; production otherwise.
  if (env === 'development' || env === 'testing') {
    return `http://localhost:5001/${projectId}/us-central1`;
  }

  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

function getApiUrl(environment) {
  const env = environment || this.getEnvironment();

  // Local for development OR testing; production otherwise.
  if (env === 'development' || env === 'testing') {
    return 'http://localhost:5002';
  }

  // Prod: api.<authDomain>. Mirrors web-manager.getApiUrl behavior.
  const authDomain = this?.config?.firebaseConfig?.authDomain;
  if (!authDomain) {
    throw new Error('firebaseConfig.authDomain not set in config/omega.json5');
  }

  return `https://api.${authDomain}`;
}

// Marketing-site / brand website URL. Dev → `https://localhost:4000` (matches BEM's
// jekyll-emulator port convention). Prod → `config.brand.url`. Use this whenever app
// code wants to link out to "the website" (Help → Website tray/menu items, "Open in
// browser," billing portal landings) so dev runs don't punch out to the real domain.
function getWebsiteUrl(environment) {
  const env = environment || this.getEnvironment();

  // Local for development OR testing; production otherwise.
  if (env === 'development' || env === 'testing') {
    return 'https://localhost:4000';
  }

  const url = this?.config?.brand?.url;
  if (!url) {
    throw new Error('brand.url not set in config/omega.json5');
  }
  return url;
}

// Sign-in URL that round-trips an auth token back to the app. Points at the brand
// website's /signin page (UJM), chained through its /token page so a successful login
// mints a Firebase custom token and redirects to `<brand.id>://auth/token` — the
// deep-link built-in that hands the token to web-manager-bridge (signInWithCustomToken).
// Same env split as getWebsiteUrl: dev/test → the local website, prod → brand.url.
// The token page redirects with ?authToken=<token> — the ONE modern shape the
// auth/token route reads (legacy-app formats are UJM's concern, not @omegajs/desktop's).
//
// `returnUrl` overrides the final hop (default: `<brand.id>://auth/token`). Used by
// lib/auth-flow.js in dev, where the custom scheme isn't OS-registered — the flow
// returns to a loopback HTTP listener instead (RFC 8252 §7.3).
function getAuthUrl(environment, returnUrl) {
  const site = this.getWebsiteUrl(environment);
  const brandId = this?.config?.brand?.id;
  if (!brandId) {
    throw new Error('brand.id not set in config/omega.json5');
  }

  const tokenUrl = new URL('/token', site);
  tokenUrl.searchParams.set('authReturnUrl', returnUrl || `${brandId}://auth/token`);

  const signinUrl = new URL('/signin', site);
  signinUrl.searchParams.set('authReturnUrl', tokenUrl.toString());
  return signinUrl.toString();
}

// Mix the URL helpers into a Manager constructor's prototype + the constructor itself.
// getEnvironment() is NOT attached here — it's the SSOT in src/utils/mode-helpers.js.
// These helpers call `this.getEnvironment()`, so mode-helpers' attachTo() must run before
// (or alongside) this one — every Manager entry point attaches mode-helpers first.
function attachTo(Manager) {
  Manager.prototype.getFunctionsUrl  = getFunctionsUrl;
  Manager.prototype.getApiUrl        = getApiUrl;
  Manager.prototype.getWebsiteUrl    = getWebsiteUrl;
  Manager.prototype.getAuthUrl       = getAuthUrl;
  Manager.getFunctionsUrl  = getFunctionsUrl;
  Manager.getApiUrl        = getApiUrl;
  Manager.getWebsiteUrl    = getWebsiteUrl;
  Manager.getAuthUrl       = getAuthUrl;
}

module.exports = {
  attachTo,
  getFunctionsUrl,
  getApiUrl,
  getWebsiteUrl,
  getAuthUrl,
};
