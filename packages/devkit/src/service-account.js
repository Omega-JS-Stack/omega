/**
 * The Firebase service-account key's ONE lookup
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)), and the ONE
 * spelling of every path under the brand's secrets folder
 * ([#897](https://github.com/Omega-JS-Stack/omega/issues/897)).
 *
 * The key is a FILE the cloud manage service mints, never a `.env` value, so
 * everything that needs it (the backend stage, the deploy-roles read, the
 * secrets publish that sends it to a runner) resolves the same two candidates
 * in the same order: the target root's own, then the brand's secrets folder.
 * It lived in the backend's stage helper while the backend was its only reader;
 * the shared secrets publisher reads it now, and devkit never requires a
 * framework, so the lookup lives here and the backend imports it.
 *
 * The Google OAuth client the authentication service writes obeys the same
 * folder rule, so it is named here too: a rename of the folder is one edit,
 * not a hunt through every manager and backend reader.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { findBrandRoot } = require('@omega.js/config');

// The brand-level home of every minted credential, and the two files in it.
const SECRETS_DIR = path.join('.omega', 'secrets');
const SERVICE_ACCOUNT_REL = path.join(SECRETS_DIR, 'service-account.json');
const GOOGLE_OAUTH_REL = path.join(SECRETS_DIR, 'google-oauth.json');

/**
 * The service-account key a target deploys with, or null when none is minted.
 *
 * @param {string} projectDir - The target root.
 * @returns {string|null} Absolute path to the key file.
 */
function resolveServiceAccountPath(projectDir) {
  const brandRoot = findBrandRoot(projectDir);

  return [
    path.join(projectDir, 'service-account.json'),
    brandRoot ? path.join(brandRoot, SERVICE_ACCOUNT_REL) : null,
  ].filter(Boolean).find((candidate) => jetpack.exists(candidate)) || null;
}

module.exports = { resolveServiceAccountPath, SECRETS_DIR, SERVICE_ACCOUNT_REL, GOOGLE_OAUTH_REL };
