// Read the OMEGA_BUILD_JSON snapshot back OUT of an emitted bundle.
//
// Since [#743](https://github.com/Omega-JS-Stack/omega/issues/743) the snapshot
// is not a file any more — bundle.js's `buildJsonBanner` prepends a one-line
// IIFE to every emitted bundle that assigns it onto globalThis/self/window, and
// there is no `build.js` / `build.json` left to read. Anything that INSPECTS a
// built artifact (the build-lane tests, the extension-auth e2e lane) needs the
// same answer a browser gets, so it RUNS that banner the way a browser would
// rather than regexing the text.

const fs = require('fs');
const vm = require('vm');

/**
 * The build snapshot an emitted bundle carries.
 * @param {string} file - absolute path of an emitted `.bundle.js`
 * @returns {object} the OMEGA_BUILD_JSON blob (`{ timestamp, repo, environment, license, packages, config }`)
 * @throws {Error} when the file carries no bake — a bundle without one is a broken build, never a default
 */
function readBakedBuildJson(file) {
  const banner = fs.readFileSync(file, 'utf8').split('\n', 1)[0];

  // The banner is a self-contained IIFE with no imports and no browser APIs, so
  // a bare context is all it needs — and `globalThis` inside the context IS the
  // context, which is the same assignment a service worker's `self` receives.
  const scope = {};
  try {
    vm.runInNewContext(banner, scope);
  } catch (e) {
    // A first line that is not the banner is the bundle's own code, which is
    // neither self-contained nor runnable here — say what is actually wrong
    // rather than handing back esbuild's output as a parse error.
    throw new Error(`${file} carries no OMEGA_BUILD_JSON bake — its first line is not the bundle task's banner (${e.message})`);
  }

  if (!scope.OMEGA_BUILD_JSON) {
    throw new Error(`${file} carries no OMEGA_BUILD_JSON bake — its first line assigned nothing (the bundle task's banner is missing)`);
  }

  return scope.OMEGA_BUILD_JSON;
}

module.exports = { readBakedBuildJson };
