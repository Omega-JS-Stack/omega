/**
 * Deterministic admin-account passwords — HMAC-SHA256 of the account email +
 * the brand's apex domain, keyed by the brand-local ACCOUNT_PASSWORD_SEED.
 * Same inputs → same password on every run (the service converges Firebase
 * Auth to it), different per account and per brand, and nothing stored
 * anywhere but the seed in the gitignored brand .env.
 *
 * De-ITW'd from omega-manager, whose generate-password.js encoded the
 * company's personal keyboard-column formula in code. Rotating the seed is
 * safe but noisy: the next run updates every managed account's password.
 */
const { createHmac } = require('node:crypto');

const { getApexDomain } = require('../../../lib/domain-utils.js');

/**
 * Derive the password for a managed account.
 *
 * The static prefix guarantees the uppercase/digit/symbol character classes
 * regardless of what the digest contains; the 20 base64url chars carry the
 * entropy.
 *
 * @param {string} seed - ACCOUNT_PASSWORD_SEED from the brand .env
 * @param {string} email - Account email address
 * @param {string} domain - Brand domain (e.g. 'mybrand.com'); apex is used
 *   so subdomain changes in brand.url don't rotate passwords
 * @returns {string} Derived password
 */
function derivePassword(seed, email, domain) {
  const apex = getApexDomain(domain);
  const digest = createHmac('sha256', seed).update(`${email}:${apex}`).digest('base64url');

  return `A1!${digest.slice(0, 20)}`;
}

module.exports = { derivePassword };
