/**
 * AdSense service — verifies the brand's domain is added to the configured
 * AdSense account and reports its approval state.
 *
 * The Management API v2 is read-only (sites can't be added or configured
 * programmatically), so this service proves presence + state and deep-links
 * the console for the manual half; the add-site browser poll loop rides the
 * prompting port. Never mutates — dry-run is identical to a normal run.
 *
 * accountId (pub-…) is required config — omega-manager defaulted it to the
 * company's shared account; account selection rides the prompting port.
 * Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env
 * (adsense.readonly scope, own token cache).
 */
const { join } = require('node:path');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { GoogleAdsenseAPI } = require('./lib/adsense-api.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const adsense = context.brandConfig.adsense || {};

    if (adsense.enabled === false) {
      return { skip: true, reason: 'adsense.enabled = false' };
    }

    const domain = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    if (!adsense.accountId) {
      return { skip: true, reason: 'no adsense.accountId configured (pub-… from https://adsense.google.com → Settings → Account information)' };
    }

    if (!context.adsenseApi && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
      return { skip: true, reason: 'no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET configured (set them in the brand .env)' };
    }

    // Tests inject a fake client via context.adsenseApi
    return {
      adsenseApi: context.adsenseApi || new GoogleAdsenseAPI({
        tokenStorePath: join(context.brandRoot, '.omega', 'auth', 'google-adsense-tokens.json'),
      }),
      accountId: adsense.accountId,
      domain,
    };
  },
});
