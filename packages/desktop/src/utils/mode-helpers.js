// Runtime mode helpers: plain functions the process `Omega` classes (src/main.js,
// src/preload.js, src/renderer.js) and the build-time module (src/build.js) call.
//
// The environment half is NOT implemented here any more
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)). It is
// @omega.js/config's `environment.js`, the ONE module every OMEGA target
// answers from, and this file only re-exports it beside desktop's own
// getVersion(). The four copies this replaced each carried their own signal
// list and their own default, and they disagreed: desktop's answered
// `production` with no signal while the extension's answered `development`, so
// a desktop dev boot bundled itself as a production artifact.
//
// The contract, in full, is the shared module's:
//   getEnvironment() reads ONE input, the `OMEGA_ENVIRONMENT` variable in Node
//   and the baked `OMEGA_BUILD_JSON.config.environment` in a renderer (which
//   has no process.env), and a context with neither throws by name. Nothing
//   sniffs `app.isPackaged` or NODE_ENV any more: the lane that boots or builds
//   this app names the environment, once, where it resolves its config
//   (src/build.js's getConfig for the build lane, main.js's initialize for the
//   packaged runtime).
//
//   isDevelopment() / isProduction() / isTesting() DERIVE from it, so they can
//   never disagree with it and exactly one is true. isProduction() is a real
//   positive check, never `!isDevelopment()`. Gate "anything non-production"
//   with `!isProduction()` or `isDevelopment() || isTesting()` intentionally.
//
// The shared module requires nothing, so it rides the renderer bundle (a
// browser context with no Node built-ins) exactly as this file always has.
const environment = require('@omega.js/config/environment');

// `getVersion()` returns the app's version string. Sources, in priority order:
//   1. `electron.app.getVersion()` when running inside Electron (main process,
//      authoritative; reads from the packaged app's package.json baked into asar).
//   2. `<cwd>/package.json#version` for build-time scripts / non-Electron contexts.
//   3. null when neither resolves.
//
// Renderer caveat: `electron.app` isn't available in renderer, so the fallback to
// `process.cwd()/package.json` won't find anything useful in a packaged app.
// Renderers that need the version should ask main via IPC, or read
// `OMEGA_BUILD_JSON.package.version` (baked in by the bundle task).
function getVersion() {
  if (typeof require !== 'undefined') {
    try {
      const { app } = require('electron');
      if (app && typeof app.getVersion === 'function') return app.getVersion();
    } catch (_) {}
  }
  // Build-time scripts / non-Electron contexts: read project package.json.
  try {
    const path = require('path');
    const pkg = require(path.join(process.cwd(), 'package.json'));
    return pkg.version || null;
  } catch (_) {
    // Only legitimate failure: no package.json at cwd. Tolerate so build-time
    // tooling running outside a project root still loads cleanly.
    return null;
  }
}

module.exports = {
  isDevelopment: environment.isDevelopment,
  isProduction: environment.isProduction,
  isTesting: environment.isTesting,
  getEnvironment: environment.getEnvironment,
  getVersion,
};
