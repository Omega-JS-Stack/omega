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
// and the test harness. A browser context learns a BUMPED port from the map the
// build baked into every bundle as OMEGA_BUILD_JSON (`dev.ports`,
// [#300](https://github.com/Omega-JS-Stack/omega/issues/300)), the same channel
// background.js reads the auth port from. There is no last resort under it
// (#834): the classic defaults used to be hand-typed here for "a build made
// with no local stack up", which is a guess about a port nothing
// identity-checks, so a miss is loud instead.

// The missing-fact error is the ONE shared one (#834). Its module requires
// nothing, so it rides every browser bundle exactly as this file does.
const { devFactMissing } = require('@omega.js/config/dev-facts');

// The step that writes the resolved dev map into this surface's artifact, named
// in every missing-fact error below.
const DEV_FACT_WRITER = "@omega.js/extension's bundle task, from the live stack's ports file plus the OMEGA_*_PORT env channel";

function envPort(name) {
  return typeof process !== 'undefined' && process.env
    ? process.env[name]
    : undefined;
}

// One local port, from whichever channel this context has: the env var first
// (build-time Node + the test harness), then the baked map
// ([#744](https://github.com/Omega-JS-Stack/omega/issues/744)).
function localPort(context, envName, name) {
  return envPort(envName) || context?.config?.dev?.ports?.[name];
}

// The same read, REQUIRED: a getter answering with a local address answers with
// a RESOLVED one or not at all (#834).
function requiredPort(context, envName, name) {
  const port = localPort(context, envName, name);

  if (!port) {
    throw devFactMissing(`dev port for \`${name}\``, DEV_FACT_WRITER);
  }

  return port;
}

function getApiUrl(environment) {
  const env = environment || this.getEnvironment();

  // Local for development OR testing; production otherwise. Mirrors
  // @omega.js/backend's getApiUrl (N7): a published OMEGA_HTTPS_PORT means
  // `mgr serve`'s mkcert proxy is up (https); otherwise plain http to the
  // hosting emulator (env port, then baked port). Neither resolved is a broken
  // build, not a case to assume the classic 5002 through (#834).
  if (env === 'development' || env === 'testing') {
    const httpsPort = localPort(this, 'OMEGA_HTTPS_PORT', 'https');
    return httpsPort
      ? `https://localhost:${httpsPort}`
      : `http://localhost:${requiredPort(this, 'OMEGA_HOSTING_PORT', 'hosting')}`;
  }

  // Prod: api.<brand host>. Mirrors @omega.js/client.getApiUrl. Never derive
  // from authDomain — it is an auth concern (the brand host, with /__/auth/*
  // self-hosted at build time) and must stay free to change independently.
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
  localPort,
  requiredPort,
  getApiUrl,
};
