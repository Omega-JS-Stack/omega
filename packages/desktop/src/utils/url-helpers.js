// Backend URL helpers: plain functions the process `Omega` classes (main / renderer /
// preload) call, each passing itself as `context`. Mirror
// @omega.js/client's contract so @omega.js/desktop apps can hit the same dev/prod backends as
// @omega.js/web and @omega.js/extension consumers.
//
// `getEnvironment()` is the SINGLE SOURCE OF TRUTH and lives in src/utils/mode-helpers.js
// (alongside the is*() family, the same on every framework). It returns exactly ONE of
// 'development' | 'testing' | 'production' (mutually exclusive; testing wins).
//
// `getFunctionsUrl()` / `getApiUrl()` / `getWebsiteUrl()` route through the context's
// `getEnvironment()` and resolve to LOCAL urls in BOTH development AND testing,
// callers normally pass NO argument. An explicit `environment` arg is an override
// (used mainly by tests to pin a specific environment's mapping).

// The missing-fact error is the ONE shared one (#834). Its module requires
// nothing, so it rides the renderer bundle exactly as this file does.
const { devFactMissing } = require('@omega.js/config/dev-facts');

// Guarded the way @omega.js/extension's twin is: the renderer bundle is a
// browser context, and only the Node-side contexts (main, preload, build, the
// test harness) carry the resolved-port env channel.
function envPort(name) {
  return typeof process !== 'undefined' && process.env
    ? process.env[name]
    : undefined;
}

// The step that writes the resolved dev map into this surface's artifact, named
// in every missing-fact error below (#834).
const DEV_FACT_WRITER = "@omega.js/desktop's bundle task, from the live stack's ports file plus the OMEGA_*_PORT env channel";

// One local port, from whichever channel this context has: the env var first
// (the CLI that booted the stack publishes it, N7), then the `dev.ports` map
// the bundle baked into OMEGA_BUILD_JSON: a PACKAGED main process has no
// parent env, so a bumped emulator port reaches it only that way
// ([#745](https://github.com/Omega-JS-Stack/omega/issues/745)). Same helper,
// same order as @omega.js/extension's src/utils/url-helpers.js.
//
// There is no third step any more (#834): the classic numbers used to be
// hand-typed here as a last resort for "a build made with no stack up", which
// is a guess about a port nothing identity-checks. A miss is loud instead.
function localPort(context, envName, name) {
  return envPort(envName) || context?.config?.dev?.ports?.[name];
}

// The same read, REQUIRED: the one every URL getter below uses, because every
// one of them is answering with a real local address or not at all.
function requiredPort(context, envName, name) {
  const port = localPort(context, envName, name);

  if (!port) {
    throw devFactMissing(`dev port for \`${name}\``, DEV_FACT_WRITER);
  }

  return port;
}

/**
 * The Cloud Functions base: the local emulator in development and testing, the
 * project's cloudfunctions.net host in production.
 * @param {object} context - the instance asking (its `config` and `getEnvironment()`).
 * @param {string} [environment] - an override of the running environment.
 * @returns {string} the functions base URL.
 */
function getFunctionsUrl(context, environment) {
  const env = environment || context.getEnvironment();
  const projectId = context.config?.cloud?.config?.projectId;

  if (!projectId) {
    throw new Error('cloud.config.projectId not set in config/omega.json5');
  }

  // Local for development OR testing; production otherwise. The port rides the
  // same three-step chain getApiUrl() walks: the OMEGA_*_PORT env channel (N7),
  // then the baked map, then the classic default.
  if (env === 'development' || env === 'testing') {
    const port = requiredPort(context, 'OMEGA_FUNCTIONS_PORT', 'functions');
    return `http://localhost:${port}/${projectId}/us-central1`;
  }

  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

/**
 * The API base: the local stack in development and testing, the brand's api
 * subdomain in production.
 * @param {object} context - the instance asking (its `config` and `getEnvironment()`).
 * @param {string} [environment] - an override of the running environment.
 * @returns {string} the API base URL.
 */
function getApiUrl(context, environment) {
  const env = environment || context.getEnvironment();

  // Local for development OR testing; production otherwise. Mirrors
  // @omega.js/backend's getApiUrl (N7): a resolved OMEGA_HTTPS_PORT means
  // `mgr serve`'s mkcert proxy is up (https); otherwise plain http to the
  // hosting emulator (env port, then baked port). Neither resolved is a broken
  // build, not a case to assume the classic 5002 through (#834).
  if (env === 'development' || env === 'testing') {
    const httpsPort = localPort(context, 'OMEGA_HTTPS_PORT', 'https');
    return httpsPort
      ? `https://localhost:${httpsPort}`
      : `http://localhost:${requiredPort(context, 'OMEGA_HOSTING_PORT', 'hosting')}`;
  }

  // Prod: api.<brand host>. Mirrors @omega.js/client.getApiUrl. Never derive
  // from authDomain — it is an auth concern (the brand host, with /__/auth/*
  // self-hosted at build time) and must stay free to change independently.
  const brandUrl = context.config?.brand?.url;
  if (!brandUrl) {
    throw new Error('brand.url not set in config/omega.json5');
  }

  return `https://api.${new URL(brandUrl).hostname}`;
}

// Marketing-site / brand website URL. Dev → the local website's whole ORIGIN, the
// same answer @omega.js/client's getDevWebsiteOrigin() gives every other surface
// whenever the website published one
// ([#262](https://github.com/Omega-JS-Stack/omega/issues/262)): the baked
// `dev.origin` the live website published (scheme, host AND port, the complete
// fact) wins, else a port from the usual chain (OMEGA_WEBSITE_PORT, then the baked
// `dev.ports.website`) composed over https. There is no classic-origin fallback
// any more (#834): a wrong dev origin fails as a silent connection refusal. The
// scheme is https because `omega dev` fronts its public port with the mkcert
// proxy by default, so a port alone can never say it
// ([#747](https://github.com/Omega-JS-Stack/omega/issues/747)).
// Prod → `config.brand.url`. Use this whenever app code wants to link out to "the
// website" (Help → Website tray/menu items, "Open in browser," billing portal
// landings) so dev runs don't punch out to the real domain.
/**
 * @param {object} context - the instance asking (its `config` and `getEnvironment()`).
 * @param {string} [environment] - an override of the running environment.
 * @returns {string} the website origin (dev) or brand.url (production).
 */
function getWebsiteUrl(context, environment) {
  const env = environment || context.getEnvironment();

  // Local for development OR testing; production otherwise.
  if (env === 'development' || env === 'testing') {
    const origin = context.config?.dev?.origin;
    if (origin) {
      return origin;
    }

    return `https://localhost:${requiredPort(context, 'OMEGA_WEBSITE_PORT', 'website')}`;
  }

  const url = context.config?.brand?.url;
  if (!url) {
    throw new Error('brand.url not set in config/omega.json5');
  }
  return url;
}

// Sign-in URL that round-trips an auth token back to the app. Points at the brand
// website's /signin page, chained through its /token page so a successful login
// mints a Firebase custom token and redirects to `<brand.id>://auth/token` — the
// deep-link built-in that hands the token to lib/auth.js (signInWithCustomToken).
// Same env split as getWebsiteUrl: dev/test → the local website, prod → brand.url.
// The token page redirects with ?authToken=<token> — the ONE modern shape the
// auth/token route reads (older formats are not read).
//
// `returnUrl` overrides the final hop (default: `<brand.id>://auth/token`). Used by
// lib/auth-flow.js in dev, where the custom scheme isn't OS-registered — the flow
// returns to a loopback HTTP listener instead (RFC 8252 §7.3).
/**
 * @param {object} context - the instance asking (its `config` and `getEnvironment()`).
 * @param {string} [environment] - an override of the running environment.
 * @param {string} [returnUrl] - the final hop, `<brand.id>://auth/token` by default.
 * @returns {string} the sign-in URL.
 */
function getAuthUrl(context, environment, returnUrl) {
  const site = getWebsiteUrl(context, environment);
  const brandId = context.config?.brand?.id;
  if (!brandId) {
    throw new Error('brand.id not set in config/omega.json5');
  }

  const tokenUrl = new URL('/token', site);
  tokenUrl.searchParams.set('authReturnUrl', returnUrl || `${brandId}://auth/token`);

  const signinUrl = new URL('/signin', site);
  signinUrl.searchParams.set('authReturnUrl', tokenUrl.toString());
  return signinUrl.toString();
}

module.exports = {
  localPort,
  requiredPort,
  getFunctionsUrl,
  getApiUrl,
  getWebsiteUrl,
  getAuthUrl,
};
