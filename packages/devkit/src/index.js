// @omegajs/devkit — shared build-time internals for the OMEGA frameworks.
//
// Private workspace package: never published to npm. Each framework imports these
// modules by name (e.g. @omegajs/devkit/logger) and vendors them into its dist/ at
// prepare time via ./tools/vendor.js, so published tarballs are self-contained.
// NOTE: don't write a literal require of the package name anywhere in this package,
// comments included — vendored copies must stay free of raw @omegajs require() calls,
// and CI greps shipped dist for that pattern as the self-containment gate.

module.exports = {
  Logger: require('./logger'),
  safeInstall: require('./safe-install').safeInstall,
  attachLogFile: require('./attach-log-file'),
};
