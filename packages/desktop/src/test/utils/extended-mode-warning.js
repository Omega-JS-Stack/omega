// TEST_EXTENDED_MODE warning — SSOT for consistent messaging.
//
// The headline + shape live in @omegajs/devkit (mirrored across @omegajs/backend/BXM/UJM); these
// detail lines describe @omegajs/desktop's blast radius. Used by the test command (printed to
// console + teed to logs/test.log).
const { makeExtendedModeWarning } = require('@omegajs/devkit/test/extended-mode-warning');

const EXTENDED_MODE_WARNING = makeExtendedModeWarning([
  'Tests that hit real external services (Firebase, analytics, update feeds) are ENABLED!',
  'This will make real network calls against live backends.',
]);

module.exports = { EXTENDED_MODE_WARNING };
