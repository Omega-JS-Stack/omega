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
};

module.exports = { PATHS };
