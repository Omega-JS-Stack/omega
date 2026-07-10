// Shared devkit module — vendored into dist/vendor/devkit at prepare time by the
// preparePackage `after` hook. This shim keeps the framework's internal require
// paths stable while the implementation lives in @omega.js/devkit.
module.exports = require('@omega.js/devkit/test/assert');
