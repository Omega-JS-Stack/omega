/**
 * The domain role's provider registry, one entry per provider in each of its
 * two roles: the registrar (`domain.providers.<id>`) and the mailbox provider
 * (`domain.email.providers.<id>`). Every rule keyed on a provider name reads it.
 *
 * registrar: `api` the client that sets nameservers (null = manual guidance),
 * `nameserverUrl` the dashboard page the zone flow opens (the credentials
 * each registrar needs are the env schema's `askedWhen`). mailbox: `mx` its records, `mxDomain` the domain
 * any MX of its points into, `spf` its SPF include, `label` its MX comment,
 * `routing` whether the edge service's Email Routing forwards its mail.
 * Presence picks a provider (chosenProvider); no entry means nothing chosen.
 */
const { chosenProvider } = require('@omega.js/config');
const { NamecheapAPI } = require('./namecheap-api.js');

const DOMAIN_PROVIDERS = {
  registrar: {
    namecheap: {
      api: NamecheapAPI,
      nameserverUrl: (domain) => `https://ap.www.namecheap.com/domains/domaincontrolpanel/${domain}/domain`,
    },
    squarespace: {
      api: null,
      nameserverUrl: (domain) => `https://account.squarespace.com/domains/managed/${domain}/dns/domain-nameservers`,
    },
  },
  mailbox: {
    squarespace: {
      mx: [{ host: 'mxa.mailgun.org', priority: 10 }, { host: 'mxb.mailgun.org', priority: 10 }],
      mxDomain: 'mailgun.org',
      spf: 'mailgun.org',
      label: 'Squarespace email forwarding',
      routing: false,
    },
    privateemail: {
      mx: [{ host: 'mx1.privateemail.com', priority: 10 }, { host: 'mx2.privateemail.com', priority: 10 }],
      mxDomain: 'privateemail.com',
      spf: 'spf.privateemail.com',
      label: 'Private email forwarding (Namecheap)',
      routing: false,
    },
    cloudflare: {
      mx: [
        { host: 'route1.mx.cloudflare.net', priority: 36 },
        { host: 'route2.mx.cloudflare.net', priority: 4 },
        { host: 'route3.mx.cloudflare.net', priority: 24 },
      ],
      mxDomain: 'cloudflare.net',
      spf: '_spf.mx.cloudflare.net',
      label: 'Cloudflare Email Routing',
      routing: true,
    },
  },
};

/**
 * The brand's domain registrar (`domain.providers.<registrar>`).
 *
 * @param {Object} brandConfig - Resolved brand config
 * @returns {string|null} - A DOMAIN_PROVIDERS.registrar key, or null
 */
function resolveRegistrar(brandConfig) {
  return chosenProvider(brandConfig?.domain?.providers);
}

/**
 * The brand's mailbox provider (`domain.email.providers.<provider>`).
 *
 * @param {Object} brandConfig - Resolved brand config
 * @returns {string|null} - A DOMAIN_PROVIDERS.mailbox key, or null
 */
function resolveEmailProvider(brandConfig) {
  return chosenProvider(brandConfig?.domain?.email?.providers);
}

module.exports = { DOMAIN_PROVIDERS, resolveRegistrar, resolveEmailProvider };
