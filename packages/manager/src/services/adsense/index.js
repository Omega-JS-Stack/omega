/**
 * AdSense service — verifies the brand's domain is added to the configured
 * AdSense account and reports its approval state.
 *
 * The Management API v2 is read-only (sites can't be added or configured
 * programmatically), so this service proves presence + state and deep-links
 * the console for the manual half; the add-site browser poll loop is next up as a
 * verification-poll adoption. Never mutates AdSense — dry-run is identical to a normal
 * run.
 *
 * accountId (pub-…) is required config — omega-manager defaulted it to the
 * company's shared account (company-level config supplies that now).
 * Interactive runs offer the account selection flow when it's missing
 * (create-new opens the AdSense signup) and land it in omega.json5.
 * Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env
 * (adsense.readonly scope, own token cache).
 */
const { join } = require('node:path');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { GoogleAdsenseAPI } = require('./lib/adsense-api.js');
const { resolveConfigValue } = require('../../lib/config-flow.js');

const CREATE_ACCOUNT_URL = 'https://adsense.google.com/start/';

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

    const haveCreds = Boolean(
      context.adsenseApi
      || (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    );

    // Tests inject a fake client via context.adsenseApi
    const makeApi = () => context.adsenseApi || new GoogleAdsenseAPI({
      tokenStorePath: join(context.brandRoot, '.omega', 'auth', 'google-adsense-tokens.json'),
    });

    // Missing account → offer the interactive selection flow (lands in
    // omega.json5); needs credentials
    let accountId = adsense.accountId;
    if (!accountId && haveCreds) {
      const flowApi = makeApi();
      accountId = await resolveConfigValue(context, {
        path: 'adsense.accountId',
        label: 'AdSense account',
        choices: () => flowApi.listAccounts(),
        getName: (account) => {
          const id = account.name.replace('accounts/', '');
          return `${account.displayName || id} (${id})`;
        },
        getValue: (account) => account.name.replace('accounts/', ''),
        createNew: { label: 'account', url: CREATE_ACCOUNT_URL, refreshChoices: true },
      });
    }
    if (!accountId) {
      return { skip: true, reason: 'no adsense.accountId configured (pub-… from https://adsense.google.com → Settings → Account information — or rerun interactively)' };
    }

    if (!haveCreds) {
      return { skip: true, reason: 'no GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET configured (set them in the brand .env)' };
    }

    return {
      adsenseApi: makeApi(),
      accountId,
      domain,
    };
  },
});
