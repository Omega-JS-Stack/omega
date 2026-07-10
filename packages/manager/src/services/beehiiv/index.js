/**
 * Beehiiv service — the brand's newsletter publication: access verified (or
 * auto-matched by name), @omegajs/backend's custom fields provisioned, @omegajs/backend's segments
 * ensured (Beehiiv has no segment-create API — missing ones get readable
 * instructions, and interactive runs offer to create them by driving the
 * dashboard UI through the companion Chrome extension), and the
 * publication webhook pointed at the parent @omegajs/backend's forwarder.
 *
 * Publications are created manually in the dashboard (no API) — the service
 * prints the exact values to copy when none matches.
 *
 * Auth: BEEHIIV_API_KEY in the brand .env; the webhook operation
 * additionally needs BACKEND_MANAGER_WEBHOOK_KEY. No API key → clean skip.
 */
const { createServiceRunner } = require('../../lib/service-runner.js');
const { BeehiivAPI } = require('./lib/beehiiv-api.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const newsletter = context.brandConfig.marketing?.newsletter || {};

    if (newsletter.enabled === false) {
      return { skip: true, reason: 'marketing.newsletter.enabled = false' };
    }

    const platform = newsletter.platform || 'beehiiv';
    if (platform !== 'beehiiv') {
      return { skip: true, reason: `marketing.newsletter.platform = '${platform}'` };
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    if (!context.beehiivApi && !process.env.BEEHIIV_API_KEY) {
      return { skip: true, reason: 'no BEEHIIV_API_KEY configured (set it in the brand .env)' };
    }

    // Tests inject a fake client via context.beehiivApi
    return {
      beehiivApi: context.beehiivApi || new BeehiivAPI(),
      domain,
    };
  },
});
