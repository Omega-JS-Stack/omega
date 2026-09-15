// Read the OMEGA_BUILD_JSON snapshot back OUT of a built artifact.
//
// Since [#743](https://github.com/Omega-JS-Stack/omega/issues/743) the snapshot
// is ONE file again, `build.js` at the artifact's root: two plain statements
// assigning `self.OMEGA_BUILD_JSON` and its `config.dev` map, which the page
// template loads with a script tag and background.js with importScripts.
// Anything that INSPECTS a built artifact (the build-lane tests, the
// extension-auth e2e lane) needs the same answer a browser gets, so it RUNS
// that file the way a browser would rather than regexing the text.

const fs = require('fs');
const vm = require('vm');

/**
 * The build snapshot an artifact carries.
 * @param {string} file - absolute path of an emitted `build.js`
 * @returns {object} the OMEGA_BUILD_JSON wrapper (`{ config, package, mode, license, builtAt }`)
 * @throws {Error} when the file carries no snapshot: an artifact without one is a broken build, never a default
 */
function readBakedBuildJson(file) {
  const source = fs.readFileSync(file, 'utf8');

  // The file is self-contained, with no imports and no browser APIs, and `self`
  // is the one global it assigns: the same scope a service worker's
  // importScripts gives it and a page's script tag gives it.
  const scope = { self: {} };
  try {
    vm.runInNewContext(source, scope);
  } catch (e) {
    throw new Error(`${file} is not an OMEGA_BUILD_JSON file (it did not run as one: ${e.message})`);
  }

  if (!scope.self.OMEGA_BUILD_JSON) {
    throw new Error(`${file} assigned no OMEGA_BUILD_JSON: the build wrote something else here`);
  }

  return scope.self.OMEGA_BUILD_JSON;
}

module.exports = { readBakedBuildJson };
