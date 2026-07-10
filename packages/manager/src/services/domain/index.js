/**
 * Domain service — points the registrar at Cloudflare. Runs after cloudflare
 * (the zone must exist so its assigned nameservers are known). API-capable
 * registrars (namecheap) are reconciled automatically; manual registrars get
 * printed instructions, and only while the zone is still pending — an active
 * zone proves the nameservers are already set.
 *
 * The email half of `domain` config (email.provider, email.forwarding) is
 * consumed by the cloudflare service (dns-records MX/SPF + email-routing);
 * this service owns only the registrar side.
 *
 * Auth: NAMECHEAP_USERNAME + NAMECHEAP_API_KEY in the brand .env (namecheap
 * only), plus CLOUDFLARE_TOKEN to read the zone's assigned nameservers.
 * Missing credentials → the service skips with guidance.
 */
const chalk = require('chalk').default;
const { createServiceRunner } = require('../../lib/service-runner.js');
const { CloudflareAPI } = require('../cloudflare/lib/cloudflare-api.js');
const { getApexDomain } = require('../../lib/domain-utils.js');
const { NamecheapAPI } = require('./lib/namecheap-api.js');
const { API_PROVIDERS } = require('./lib/registrars.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const domainConfig = context.brandConfig.domain || {};

    if (domainConfig.enabled === false) {
      return { skip: true, reason: 'domain.enabled = false' };
    }

    const provider = domainConfig.provider;
    if (!provider) {
      return { skip: true, reason: 'no domain.provider configured' };
    }

    const url = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '');
    if (!url) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    // The zone lookup needs Cloudflare even for manual registrars — the
    // required nameserver values come from the zone
    if (!context.cloudflareApi && !process.env.CLOUDFLARE_TOKEN) {
      return { skip: true, reason: 'no CLOUDFLARE_TOKEN configured (needed to read the zone nameservers; set it in the brand .env)' };
    }

    if (
      provider === 'namecheap'
      && !context.namecheapApi
      && (!process.env.NAMECHEAP_USERNAME || !process.env.NAMECHEAP_API_KEY)
    ) {
      return { skip: true, reason: 'no NAMECHEAP_USERNAME/NAMECHEAP_API_KEY configured (set them in the brand .env)' };
    }

    console.log(`    Provider: ${chalk.cyan(provider)}${API_PROVIDERS.has(provider) ? '' : chalk.dim(' (manual)')}`);

    // Tests inject fake clients via context.cloudflareApi / context.namecheapApi
    return {
      cloudflareApi: context.cloudflareApi || new CloudflareAPI(),
      namecheapApi: provider === 'namecheap' ? (context.namecheapApi || new NamecheapAPI()) : null,
      domain: getApexDomain(url), // nameservers live on the apex's registrar entry
      provider,
    };
  },
});
