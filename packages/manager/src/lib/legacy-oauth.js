/**
 * The one-time legacy OAuth-secret conversion, run at PORT time
 * ([#501](https://github.com/Omega-JS-Stack/omega/issues/501)).
 *
 * omega-manager kept the brand's Google OAuth client in `oauth.json` with the
 * keys `{ googleClientId, googleClientSecret }`. OMEGA's home is
 * `.omega/secrets/google-oauth.json` with `{ clientId, clientSecret }`
 * (services/cloud/ensure/authentication.js), so a hand-carried legacy file sat
 * inert beside it — the client only became real again once a live `omega
 * manage` re-derived it from Firebase.
 *
 * Per the standing ruling (Ian 2026-08-21) no framework run dual-reads an old
 * shape: onboarding CONVERTS the carried file once and removes it, and the
 * authentication service never learns the legacy filename or key names.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const LEGACY_FILE = 'oauth.json';
const CANONICAL_FILE = 'google-oauth.json';

/**
 * Convert a carried legacy `oauth.json` into the canonical
 * `google-oauth.json`, then delete the legacy file (the conversion is
 * one-time, so a rerun finds nothing and reports a clean no-op).
 *
 * @param {string} brandRoot - The brand root directory.
 * @returns {{ converted: boolean, reason?: string }} `reason` names why a
 *   present legacy file was left alone.
 */
function convertLegacyOAuthSecret(brandRoot) {
  const secretsDir = join(brandRoot, '.omega', 'secrets');
  const legacyPath = join(secretsDir, LEGACY_FILE);

  if (!jetpack.exists(legacyPath)) {
    return { converted: false };
  }

  if (jetpack.exists(join(secretsDir, CANONICAL_FILE))) {
    return { converted: false, reason: `${CANONICAL_FILE} already exists — ${LEGACY_FILE} left for you to compare and delete` };
  }

  // A hand-carried file is external input: an unreadable or unrecognized one
  // is reported, never guessed at
  const legacy = jetpack.read(legacyPath, 'json');
  if (!legacy?.googleClientId || !legacy?.googleClientSecret) {
    return { converted: false, reason: `${LEGACY_FILE} carries no googleClientId/googleClientSecret pair` };
  }

  jetpack.write(join(secretsDir, CANONICAL_FILE), {
    clientId: legacy.googleClientId,
    clientSecret: legacy.googleClientSecret,
  });
  jetpack.remove(legacyPath);

  return { converted: true };
}

module.exports = { convertLegacyOAuthSecret };
