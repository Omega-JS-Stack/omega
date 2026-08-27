/**
 * Domain service — points the registrar at Cloudflare. Runs after cloudflare
 * (the zone must exist so its assigned nameservers are known). API-capable
 * registrars (namecheap) are reconciled automatically; manual registrars get
 * printed instructions, and only while the zone is still pending — an active
 * zone proves the nameservers are already set.
 *
 * The email half of `domain` config (email.providers, email.forwarding) is
 * consumed by the cloudflare service (dns-records MX/SPF + email-routing);
 * this service owns only the registrar side.
 *
 * Auth: NAMECHEAP_USERNAME + NAMECHEAP_API_KEY in the brand .env (namecheap
 * only), plus CLOUDFLARE_TOKEN to read the zone's assigned nameservers.
 * Missing credentials → the service skips with guidance.
 */
const chalk = require('chalk').default;
const { serviceInputSpec } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { requestServiceInput } = require('../../lib/service-input.js');
const { CloudflareAPI } = require('../edge/lib/cloudflare-api.js');
const { getApexDomain } = require('../../lib/domain-utils.js');
const { NamecheapAPI } = require('./lib/namecheap-api.js');
const { API_PROVIDERS, resolveRegistrar } = require('./lib/registrars.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const domainConfig = context.brandConfig.domain || {};

    if (domainConfig.enabled === false) {
      return { skip: true, reason: 'domain.enabled = false' };
    }

    const provider = resolveRegistrar(context.brandConfig);
    if (!provider) {
      return { skip: true, reason: 'no domain.providers.<registrar> configured' };
    }

    const url = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '');
    if (!url) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    // The zone lookup needs Cloudflare even for manual registrars — the
    // required nameserver values come from the zone
    // The input descriptors live in the REQUIRES registry (one home): the
    // Cloudflare token is unconditional, the namecheap credentials are
    // registrar-specific (their entry-level `when` drops them for the rest)
    if (!context.cloudflareApi) {
      const gate = await requestServiceInput(context, serviceInputSpec('domain', { names: ['CLOUDFLARE_TOKEN'] }));
      if (gate) return gate;
    }

    if (provider === 'namecheap' && !context.namecheapApi) {
      const gate = await requestServiceInput(context, serviceInputSpec('domain', { names: ['NAMECHEAP_USERNAME', 'NAMECHEAP_API_KEY'] }));
      if (gate) return gate;
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
