/**
 * Freshness check for derived files — a derived file needs regeneration
 * when it's missing or older than its source. This is what makes local
 * file-producing operations idempotent diff-syncs (assets: logo variants
 * from their SVG sources; certificates: .p12 exports from their .cer):
 * omega-manager regenerated blindly; the port regenerates only what's
 * stale, so a converged brand is a zero-work no-op on every run.
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
