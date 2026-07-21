/**
 * Newsletter service (Beehiiv provider) — the brand's newsletter publication: access verified (or
 * auto-matched by name), @omega.js/backend's custom fields provisioned, @omega.js/backend's segments
 * ensured (Beehiiv has no segment-create API — missing ones get readable
 * instructions, and interactive runs offer to create them by driving the
 * dashboard UI through the companion Chrome extension), and the
 * publication webhook pointed at the parent @omega.js/backend's forwarder.
 *
 * Publications are created manually in the dashboard (no API) — the service
 * prints the exact values to copy when none matches.
 *
 * Auth: BEEHIIV_API_KEY in the brand .env; the webhook operation
 * additionally needs OMEGA_WEBHOOK_KEY. No API key → clean skip.
 */
const { REQUIRES } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { ensureEnvSecrets } = require('../../lib/env-secrets.js');
const { BeehiivAPI } = require('./lib/beehiiv-api.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const newsletter = context.brandConfig.marketing?.newsletter || {};

    if (newsletter.enabled === false) {
      return { skip: true, reason: 'marketing.newsletter.enabled = false' };
    }

    const provider = newsletter.provider || 'beehiiv';
    if (provider !== 'beehiiv') {
      return { skip: true, reason: `marketing.newsletter.provider = '${provider}'` };
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    if (!context.beehiivApi) {
      const gate = await ensureEnvSecrets(context, REQUIRES.newsletter.env);
      if (gate) return gate;
    }

    // Tests inject a fake client via context.beehiivApi
    return {
      beehiivApi: context.beehiivApi || new BeehiivAPI(),
      domain,
    };
  },
});
