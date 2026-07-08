/**
 * Freshness check for derived asset files — a derived file needs
 * regeneration when it's missing or older than its source. This is what
 * makes every assets operation an idempotent diff-sync: omega-manager
 * regenerated blindly and therefore gated the write operations on
 * `--onboarding`; the port regenerates only what's stale, so a converged
 * brand is a zero-work no-op on every run.
 */
const { statSync } = require('node:fs');
const jetpack = require('fs-jetpack');

/**
 * @param {string} sourcePath - The source file (must exist)
 * @param {string} derivedPath - The derived file
 * @returns {boolean} true when the derived file must be (re)generated
 */
function isStale(sourcePath, derivedPath) {
  if (!jetpack.exists(derivedPath)) {
    return true;
  }
  return statSync(derivedPath).mtimeMs < statSync(sourcePath).mtimeMs;
}

module.exports = { isStale };
