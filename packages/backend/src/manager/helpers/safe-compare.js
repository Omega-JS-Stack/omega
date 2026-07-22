/**
 * Constant-time string comparison for secrets (admin keys, webhook keys).
 *
 * A plain `===` on a secret leaks how many leading characters match through
 * response timing. crypto.timingSafeEqual requires equal-length buffers, so
 * both inputs are reduced to a fixed-length SHA-256 digest first — the
 * comparison is then always constant-time regardless of input lengths.
 * The digest is unkeyed on purpose: it only normalizes length here, it is
 * not standing in for a MAC.
 */
const crypto = require('crypto');

/**
 * Compare two secrets in constant time.
 *
 * @param {string} a - Candidate value (e.g. from the request)
 * @param {string} b - Expected value (e.g. from the environment)
 * @returns {boolean} True when both are non-empty strings and equal
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
    return false;
  }

  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();

  return crypto.timingSafeEqual(hashA, hashB);
}

module.exports = safeCompare;
