// TEST_EXTENDED_MODE warning — SSOT for consistent messaging.
//
// The headline + shape live in @omega.js/devkit (mirrored across @omega.js/backend/EM/UJM); these
// detail lines describe BXM's blast radius. Used by the test command (printed to
// console + teed to logs/test.log).
const { makeExtendedModeWarning } = require('@omega.js/devkit/test/extended-mode-warning');

const EXTENDED_MODE_WARNING = makeExtendedModeWarning([
  'Tests that hit real external services (Firebase via @omega.js/client, push, any network call) are ENABLED!',
  'This makes real network calls from the background service worker, popup, and content scripts against live backends.',
]);

module.exports = { EXTENDED_MODE_WARNING };
