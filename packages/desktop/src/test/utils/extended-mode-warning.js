// TEST_EXTENDED_MODE warning — SSOT for consistent messaging.
//
// The headline + shape live in @omega.js/devkit (mirrored across @omega.js/backend/BXM/UJM); these
// detail lines describe @omega.js/desktop's blast radius. Used by the test command (printed to
// console + teed to logs/test.log).
const { makeExtendedModeWarning } = require('@omega.js/devkit/test/extended-mode-warning');

const EXTENDED_MODE_WARNING = makeExtendedModeWarning([
  'Tests that hit real external services (Firebase, analytics, update feeds) are ENABLED!',
  'This will make real network calls against live backends.',
]);

module.exports = { EXTENDED_MODE_WARNING };
