/**
 * The brand-.env home of each target's GA4 Measurement Protocol secret — the
 * ONE name shared by the analytics service (which resolves the secret from
 * GA and writes it) and the disperse service (which composes it into each
 * target's own .env as GOOGLE_ANALYTICS_SECRET). Per-target because every
 * surface measures through its own stream.
 *
 * It is a secret, so config/omega.json5 is not an option (the loader
 * hard-fails secret-shaped keys) — before #434 it lived in .omega/state.json
 * and disperse read it from there.
 */

/**
 * @param {string} target - Target key (web/backend/desktop/extension/mobile)
 * @returns {string} The brand .env variable name, e.g. GOOGLE_ANALYTICS_SECRET_BACKEND
 */
function streamSecretEnvName(target) {
  return `GOOGLE_ANALYTICS_SECRET_${target.toUpperCase()}`;
}

module.exports = { streamSecretEnvName };
