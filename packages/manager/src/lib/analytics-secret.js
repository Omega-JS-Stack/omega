/**
 * The brand-.env home of each target's GA4 Measurement Protocol secret — the
 * ONE name the analytics service resolves from GA and writes. Per-target
 * because every surface measures through its own stream; the per-target name
 * is delivered as GOOGLE_ANALYTICS_SECRET on every verb (composed into
 * dist/.env for backend, loaded into process.env for the others) — the env
 * schema's rename, #678.
 *
 * It is a secret, so config/omega.json5 is not an option (the loader
 * hard-fails secret-shaped keys) — before #434 it lived in .omega/state.json
 * and the composition read it from there.
 */

/**
 * @param {string} target - Target key (web/backend/desktop/extension/mobile)
 * @returns {string} The brand .env variable name, e.g. GOOGLE_ANALYTICS_SECRET_BACKEND
 */
function streamSecretEnvName(target) {
  return `GOOGLE_ANALYTICS_SECRET_${target.toUpperCase()}`;
}

module.exports = { streamSecretEnvName };
