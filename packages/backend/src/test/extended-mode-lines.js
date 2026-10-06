/**
 * The backend's detail lines under devkit's TEST_EXTENDED_MODE headline: the
 * test runner entry hands the lines to `createRunner`, and the emulator verb
 * prints the whole warning.
 */
const { makeExtendedModeWarning } = require('@omega.js/devkit/test/extended-mode-warning');

const EXTENDED_MODE_LINES = [
  'External API calls (emails, SendGrid, etc.) are ENABLED!',
  'This will send real emails and make real API calls.',
];

module.exports = { EXTENDED_MODE_LINES, EXTENDED_MODE_WARNING: makeExtendedModeWarning(EXTENDED_MODE_LINES) };
