// Runtime mode helpers, shared across BXM's eight context Managers (build /
// background / popup / options / content / sidepanel / page / offscreen).
//
// The environment half is NOT implemented here any more
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)). It is
// @omega.js/config's `environment.js`, the ONE module every OMEGA target
// answers from, and this file only re-exports it beside the extension's own
// getVersion(). The four framework copies it replaced each carried their own
// signal list and their own default, and they disagreed with each other.
//
// The contract, in full, is the shared module's:
//   getEnvironment() reads ONE input, the `OMEGA_ENVIRONMENT` variable in
//   build-time Node and the baked `OMEGA_BUILD_JSON.config.environment` in an
//   extension context (which has no process.env), and a context with neither
//   throws by name. Nothing sniffs `manifest.update_url` or NODE_ENV any more:
//   the build names the environment where it resolves its config (src/build.js's
//   getConfig) and bakes that same word into every bundle, so what an artifact
//   WAS BUILT AS is what it answers, wherever it is loaded from.
//
//   isDevelopment() / isProduction() / isTesting() DERIVE from it, so they can
//   never disagree with it and exactly one is true. isProduction() is a real
//   positive check, never `!isDevelopment()`. Gate "anything non-production"
//   with `!isProduction()` or `isDevelopment() || isTesting()` intentionally.
//
// The shared module requires nothing, so it rides every browser bundle exactly
// as this file always has.
const environment = require('@omega.js/config/environment');

// `getVersion()` returns the extension's version string.
//   1. `chrome.runtime.getManifest().version` when running inside an extension context.
//   2. `<cwd>/package.json#version` for build-time scripts.
//   3. null when neither resolves.
function getVersion() {
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
    try {
      return chrome.runtime.getManifest().version || null;
    } catch (_) { /* fall through */ }
  }
  try {
    const path = require('path');
    const pkg = require(path.join(process.cwd(), 'package.json'));
    return pkg.version || null;
  } catch (_) {
    return null;
  }
}

// Mix the helpers into a Manager constructor's prototype + the constructor itself
// (so `Manager.isTesting()` works statically too). The environment four come from
// the shared module's own attachTo(), so every extension context and every
// sibling framework hangs the identical functions; getVersion() is the
// extension's and is attached beside them.
function attachTo(Manager) {
  environment.attachTo(Manager);
  Manager.prototype.getVersion = getVersion;
  Manager.getVersion = getVersion;
}

module.exports = {
  attachTo,
  getEnvironment: environment.getEnvironment,
  isDevelopment: environment.isDevelopment,
  isProduction: environment.isProduction,
  isTesting: environment.isTesting,
  getVersion,
};
