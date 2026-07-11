// Locale field limits (Chrome Web Store requirements)
// https://developer.chrome.com/docs/webstore/i18n
// Target languages live in config/omega.json5 → translation.languages,
// validated against @omega.js/devkit/translate's language SSOT.
module.exports = {
  // Field character limits
  limits: {
    appName: 50,
    appNameShort: 25,
    appDescription: 200,
  },
};
