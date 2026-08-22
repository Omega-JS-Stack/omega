/**
 * Domain-role knowledge shared across services — which providers the domain
 * service can drive via API (their nameservers need no human), the dashboard
 * nameserver pages for the manual ones (the cloudflare zone flow opens them
 * while polling for activation), and the two provider resolvers.
 *
 * `domain` carries TWO roles, each with its own providers block (#425): the
 * registrar at `domain.providers.<registrar>` and the mailbox provider at
 * `domain.email.providers.<provider>`. Presence picks one — @omega.js/config's
 * chosenProvider owns that rule — and no entry at all means nothing chosen,
 * exactly what the old null provider meant: the domain service skips and
 * cloudflare's email operations stay off.
 */
const { chosenProvider } = require('@omega.js/config');

// Providers whose nameservers the domain service sets via API
const API_PROVIDERS = new Set(['namecheap']);

// Nameserver-management pages per registrar (manual providers get these
// opened in the browser during the zone-activation flow)
const REGISTRAR_NAMESERVER_URLS = {
  squarespace: (domain) => `https://account.squarespace.com/domains/managed/${domain}/dns/domain-nameservers`,
  namecheap: (domain) => `https://ap.www.namecheap.com/domains/domaincontrolpanel/${domain}/domain`,
};

/**
 * The brand's domain registrar (`domain.providers.<registrar>`).
 *
 * @param {Object} brandConfig - Resolved brand config
 * @returns {string|null} - 'namecheap' | 'squarespace' | … | null
 */
function resolveRegistrar(brandConfig) {
  return chosenProvider(brandConfig?.domain?.providers);
}

/**
 * The brand's mailbox provider (`domain.email.providers.<provider>`).
 *
 * @param {Object} brandConfig - Resolved brand config
 * @returns {string|null} - 'cloudflare' | 'squarespace' | 'privateemail' | … | null
 */
function resolveEmailProvider(brandConfig) {
  return chosenProvider(brandConfig?.domain?.email?.providers);
}

module.exports = { API_PROVIDERS, REGISTRAR_NAMESERVER_URLS, resolveRegistrar, resolveEmailProvider };
