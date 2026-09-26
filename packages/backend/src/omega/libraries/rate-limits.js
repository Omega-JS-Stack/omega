/**
 * Framework anti-abuse gate limits (SSOT)
 *
 * These are EXPLICIT limits on the framework's own public routes, never plan
 * features a brand prices in its `features` catalog ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
 * The per-IP signup cap is the one gate a brand tunes, so it keeps its own
 * config key (`targets.backend.auth.signup.maxPerIpPerDay`) instead of a
 * constant here.
 *
 * Used by:
 * - routes/marketing/contact/post.js (per-IP subscribe gate)
 * - routes/marketing/email-preferences/post.js (per-user and per-IP toggle gate)
 */
module.exports = {
  // How many marketing-form calls one caller may make in a counting period
  MARKETING_RATE_LIMIT: 5,
};
