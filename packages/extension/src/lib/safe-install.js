// Shared devkit module — vendored into dist/vendor/devkit at prepare time by the
// preparePackage `after` hook. This shim keeps the framework's internal require
// paths stable while the implementation lives in @omegajs/devkit.
module.exports = require('@omegajs/devkit/safe-install');
