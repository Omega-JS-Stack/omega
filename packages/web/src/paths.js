/**
 * Packaged framework content locations — the theme layers, core assets
 * (icons/logos/css/js), default pages, and the default-page translations that
 * ship WITH @omega.js/web.
 * Engine and build entry points default to these; tests and harnesses may
 * override per call.
 */
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');

const PATHS = {
  themes: path.join(PKG, 'themes'),
  core: path.join(PKG, 'core'),
  defaults: path.join(PKG, 'defaults'),
  scaffold: path.join(PKG, 'scaffold'),
  runtime: path.join(PKG, 'runtime'),
  // The default-page translations the framework ships (#621) — the cache
  // src/translate/packaged-defaults.js reads and generate-defaults.js writes.
  translations: path.join(PKG, 'translations'),
};

/**
 * Resolve the @omega.js/client entry (the `@omega.js/client` esbuild alias target).
 * In the monorepo this resolves the workspace package; published tarballs
 * carry a vendored copy (publish wiring is a later gated step).
 * @returns {string} absolute path to the client entry module
 */
function resolveClientEntry() {
  try {
    return require.resolve('@omega.js/client');
  } catch (error) {
    throw new Error('Could not resolve the @omega.js/client client package — reinstall @omega.js/web (npm install) and retry');
  }
}

module.exports = { PATHS, resolveClientEntry };
