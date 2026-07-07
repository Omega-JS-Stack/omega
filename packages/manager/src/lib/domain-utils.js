/**
 * Domain helpers — apex/subdomain resolution via the public suffix list
 * (omega-manager's src/lib/domain-utils.js, trimmed to what the manager uses).
 */
const psl = require('psl');

/**
 * Get the apex (registrable) domain for any domain.
 * e.g. 'api.mybrand.com' → 'mybrand.com', 'sub.example.co.uk' → 'example.co.uk'
 *
 * @param {string} domain - Full domain (no protocol)
 * @returns {string} Apex domain
 */
function getApexDomain(domain) {
  const parsed = psl.parse(domain);
  return parsed.domain || domain;
}

module.exports = { getApexDomain };
