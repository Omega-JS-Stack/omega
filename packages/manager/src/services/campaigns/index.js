/**
 * Campaigns service (SendGrid provider) — the brand's email-marketing infrastructure: domain
 * authentication (DKIM/SPF CNAMEs written via Cloudflare), a verified sender
 * for Single Sends, the brand's marketing list, @omega.js/backend's custom fields and
 * segments (from @omega.js/backend's SSOT), and the account-global Event
 * Webhook pointed at the parent @omega.js/backend's forwarder.
 *
 * Runs after cloudflare (the zone must exist for the DKIM records). The
 * whole service reconciles one SendGrid account per brand-or-company — the
 * fields/segments/webhook operations converge to the same result when
 * sibling brands share the account.
 *
 * Auth: SENDGRID_API_KEY in the brand .env; the event-webhook operation
 * additionally needs OMEGA_WEBHOOK_KEY. No API key → clean skip.
 */
const { chosenProvider } = require('@omega.js/config');

const { REQUIRES } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { ensureEnvSecrets } = require('../../lib/env-secrets.js');
const { CloudflareAPI } = require('../edge/lib/cloudflare-api.js');
const { getApexDomain } = require('../../lib/domain-utils.js');
const { SendGridAPI } = require('./lib/sendgrid-api.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const campaigns = context.brandConfig.marketing?.campaigns || {};

    if (campaigns.enabled === false) {
      return { skip: true, reason: 'marketing.campaigns.enabled = false' };
    }

    // The vendor is a KEY under marketing.campaigns.providers (#425) — no
    // entry means none chosen and this service skips.
    const provider = chosenProvider(campaigns.providers);
    if (!provider) {
      return { skip: true, reason: 'no marketing.campaigns.providers entry' };
    }
    if (provider !== 'sendgrid') {
      return { skip: true, reason: `marketing.campaigns.providers.${provider} is not a known email-marketing provider` };
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    if (!context.sendgridApi) {
      const gate = await ensureEnvSecrets(context, REQUIRES.campaigns.env);
      if (gate) return gate;
    }

    // Tests inject fake clients via context.sendgridApi / context.cloudflareApi.
    // Cloudflare is only needed while the domain still has to be DNS-verified;
    // without a token the domain-auth operation prints the records to add manually.
    return {
      sendgridApi: context.sendgridApi || new SendGridAPI(),
      cloudflareApi: context.cloudflareApi
        || (process.env.CLOUDFLARE_TOKEN ? new CloudflareAPI() : null),
      domain,
      apexDomain: getApexDomain(domain),
    };
  },
});
