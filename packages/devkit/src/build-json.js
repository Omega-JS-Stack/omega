/**
 * build-json: the ONE composer and the ONE writer of `OMEGA_BUILD_JSON`
 * ([#743](https://github.com/Omega-JS-Stack/omega/issues/743)).
 *
 * Every browser surface OMEGA builds (web pages and its service worker,
 * desktop's renderer windows, every extension page and the extension's service
 * worker) reads the same snapshot under the same name, so it is composed once
 * here and delivered once: a single `build.js` at the artifact's web root that
 * every shell loads with one script tag and every worker with one
 * `importScripts` line. The banners and defines each framework grew for itself
 * are gone with it (Ian 2026-09-12: "make it same shape and consumption
 * everywhere as much as possible").
 *
 * Desktop's main and preload bundles are the one exception, and not to this
 * file: they are NODE, they boot from the WHOLE resolved config inside the
 * asar, and they keep carrying it in their own bundle.
 */

const jetpack = require('fs-jetpack');
const { clientConfig } = require('@omega.js/config');

// The wrapper's `mode`, one shape on every surface
// ([#894](https://github.com/Omega-JS-Stack/omega/issues/894)): the build's
// verdict (`environment`), whether it was a BUILD rather than a dev/watch run,
// and whether it publishes. A surface's own extra verdicts (desktop's
// `server`) stay inside that surface's Manager and never reach the artifact.
const MODE_KEYS = ['environment', 'build', 'publish'];

/**
 * Compose the snapshot a browser artifact carries.
 * @param {object} input
 * @param {object} input.config - the target's resolved omega.json5.
 * @param {object} input.pkg - the project package (`{ name, version, … }`), the wrapper's `package`.
 * @param {object} input.mode - `{ environment, build, publish }`.
 * @param {object} input.license - the build's license stamp (#320).
 * @param {object} input.facts - the build facts that ride on the config (`runtime`, `environment`, `version`, `buildTime`, `target`, `dev`).
 * @returns {object} `{ config, package, mode, license, builtAt }`.
 * @throws {Error} when `mode` is missing one of its three keys: a half-stated verdict is a build bug, never a default.
 */
function composeBuildJson({ config, pkg, mode, license, facts }) {
  const missing = MODE_KEYS.filter((key) => !(mode && key in mode));
  if (missing.length) {
    throw new Error(
      `[@omega.js/devkit] OMEGA_BUILD_JSON needs a mode carrying ${MODE_KEYS.join(', ')}, missing: ${missing.join(', ')}.`,
    );
  }

  return {
    config: clientConfig({ ...config, ...facts }),
    package: pkg,
    mode: { environment: mode.environment, build: mode.build, publish: mode.publish },
    license,
    builtAt: new Date().toISOString(),
  };
}

/**
 * The text of the `build.js` file every surface writes.
 *
 * TWO statements, the same two everywhere. `self` is the one global name that
 * answers in a window and in a worker alike, so there is no IIFE and no
 * `globalThis` dance to read past. The `dev` map is its OWN statement because
 * `omega dev` REWRITES that line per request
 * ([#346](https://github.com/Omega-JS-Stack/omega/issues/346)), so the file on
 * disk stays the build's own snapshot while a served page gets the map of the
 * stack running right now. A build with no local stack writes `null`, the
 * value @omega.js/client already reads as "assume the classics".
 * @param {object} buildJson - composeBuildJson()'s answer.
 * @returns {string} the file text.
 */
function buildJsSource(buildJson) {
  const { dev = null, ...config } = buildJson.config || {};

  return `self.OMEGA_BUILD_JSON = ${JSON.stringify({ ...buildJson, config })};\n`
    + `self.OMEGA_BUILD_JSON.config.dev = ${JSON.stringify(dev)};\n`;
}

/**
 * Write `<webRoot>/build.js`.
 * @param {string} webRoot - the artifact's web root (what `/` resolves to for its pages).
 * @param {object} buildJson - composeBuildJson()'s answer.
 * @returns {string} the path written.
 */
function writeBuildJs(webRoot, buildJson) {
  const file = jetpack.path(webRoot, 'build.js');
  jetpack.write(file, buildJsSource(buildJson));

  return file;
}

module.exports = { composeBuildJson, buildJsSource, writeBuildJs, MODE_KEYS };
