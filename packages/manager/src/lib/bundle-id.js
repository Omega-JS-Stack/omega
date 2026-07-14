/**
 * Bundle-identifier policy — reverse-DNS ids derived from the brand's web
 * identity (Ian 2026-07-14: the prefix is the reverse domain, autoset at
 * onboarding from the parent company when one exists, else the brand's own
 * url).
 *
 *   deriveBundleIdPrefix('https://itwcreativeworks.com')   → 'com.itwcreativeworks'
 *   deriveBundleIdPrefix('https://playground.omegajs.dev') → 'dev.omegajs.playground'
 *   composeBundleId('com.itwcreativeworks', 'omega-playground')
 *     → 'com.itwcreativeworks.omega.playground'
 *
 * Sanitization keeps ids legal on BOTH stores: Apple allows hyphens but
 * Android package segments don't, so domain labels drop non-alphanumerics
 * and brand-id hyphens become dots (each id word is its own segment).
 */

/**
 * Reverse-DNS prefix from a company/brand url, or null when the url does
 * not parse. `www.` is dropped; every other hostname label survives (a
 * subdomain brand derives a subdomain-scoped prefix).
 *
 * @param {string} url - http(s) url (brand.url shape)
 * @returns {string|null}
 */
function deriveBundleIdPrefix(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  const labels = hostname
    .replace(/^www\./, '')
    .split('.')
    .map((label) => label.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);

  return labels.length > 0 ? labels.reverse().join('.') : null;
}

/**
 * Full bundle identifier: prefix + the brand id with hyphens as dots.
 *
 * @param {string} prefix - reverse-DNS prefix (config or derived)
 * @param {string} brandId - brand.id ('omega-playground')
 * @returns {string}
 */
function composeBundleId(prefix, brandId) {
  return `${prefix}.${String(brandId).toLowerCase().replace(/-+/g, '.')}`;
}

module.exports = { deriveBundleIdPrefix, composeBundleId };
