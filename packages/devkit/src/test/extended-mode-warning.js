// TEST_EXTENDED_MODE warning — SSOT for consistent messaging across the frameworks.
//
// `TEST_EXTENDED_MODE` is the shared, unprefixed env var that opts a test run into
// hitting REAL external services instead of skipping/stubbing them. Off by default so
// `npx omega test` stays fast and offline-safe. Each framework passes its own detail
// lines describing what "real calls" means on its surface; the headline is shared.

/**
 * Build the warning-line array printed (and teed to logs/test.log) by each
 * framework's test command when TEST_EXTENDED_MODE is on.
 *
 * @param {string[]} detailLines - Framework-specific lines describing the blast radius
 * @returns {string[]} Headline + detail lines
 */
function makeExtendedModeWarning(detailLines) {
  return [
    '⚠️⚠️⚠️  WARNING: TEST_EXTENDED_MODE IS TRUE  ⚠️⚠️⚠️',
    ...detailLines,
  ];
}

module.exports = { makeExtendedModeWarning };
