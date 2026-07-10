// Shared devkit module — vendored into dist/vendor/devkit at prepare time by the
// preparePackage `after` hook. This shim keeps the framework's internal require
// paths stable while the implementation lives in @omegajs/devkit (@omegajs/backend contributed
// the custom-key promotion: a key the framework newly adopts into its Default
// section is promoted UP from the user's Custom section with their value).
module.exports = require('@omegajs/devkit/merge-line-files');
