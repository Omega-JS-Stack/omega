/**
 * Packaged framework content locations — the theme layers, core assets
 * (icons/logos/css/js), and default pages that ship WITH @omegajs/web.
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
};

/**
 * Resolve the @omegajs/client entry (the `@omegajs/client` esbuild alias target).
 * In the monorepo this resolves the workspace package; published tarballs
 * carry a vendored copy (publish wiring is a later gated step).
 * @returns {string} absolute path to the client entry module
 */
function resolveClientEntry() {
  try {
    return require.resolve('@omegajs/client');
  } catch (error) {
    throw new Error('Could not resolve the @omegajs/client client package — reinstall @omegajs/web (npu install) and retry');
  }
}

module.exports = { PATHS, resolveClientEntry };
