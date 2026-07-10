/**
 * Registrar knowledge shared across services — which providers the domain
 * service can drive via API (their nameservers need no human), and the
 * dashboard nameserver pages for the manual ones (the cloudflare zone
 * flow opens them while polling for activation).
 */

// Providers whose nameservers the domain service sets via API
const API_PROVIDERS = new Set(['namecheap']);

// Nameserver-management pages per registrar (manual providers get these
// opened in the browser during the zone-activation flow)
const REGISTRAR_NAMESERVER_URLS = {
  squarespace: (domain) => `https://account.squarespace.com/domains/managed/${domain}/dns/domain-nameservers`,
  namecheap: (domain) => `https://ap.www.namecheap.com/domains/domaincontrolpanel/${domain}/domain`,
};

module.exports = { API_PROVIDERS, REGISTRAR_NAMESERVER_URLS };
