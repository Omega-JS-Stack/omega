/**
 * The two pixel providers, declared once — the SSOT the ensure handlers
 * (ensure/meta-pixel.js, ensure/tiktok-pixel.js) run on and the service setup
 * reads to decide whether a provider has work and needs a client at all.
 *
 * Each spec names: the config key under `analytics.providers`, the .env key
 * @omega.js/backend reads, where a human mints that token (tokenSource +
 * tokenUrl — the page the Enter-gated open lands on), the context key its
 * API client rides on, and what the platform calls the account the pixel
 * lives on. `discoverAccounts` marks a provider whose client can enumerate
 * the accounts its token sees (lib/pixel-account.js) — the others stay gated
 * on a configured accountId.
 */
const chalk = require('chalk').default;

const META_PIXEL = {
  key: 'meta',
  label: 'Meta Pixel',
  idLabel: 'Meta Pixel ID',
  envVar: 'META_ACCESS_TOKEN',
  tokenSource: 'Meta Business Settings → Users → System users → Generate new token (ads_management)',
  tokenUrl: 'https://business.facebook.com/settings/system-users',
  apiKey: 'metaApi',
  accountLabel: 'ad account',
  discoverAccounts: true,
  accountGuidance: 'Assign an ad account to the system user in Business Settings → Users → System users → Add assets',
  instructions: [
    `1. Mint a Business Manager SYSTEM USER token with ${chalk.cyan('ads_management')} (the next step opens the page)`,
    '2. The ad account that token can see is selected for you, and the pixel is created on it',
    `3. The same token signs the Conversions API events ${chalk.cyan('@omega.js/backend')} sends`,
  ],
};

// SCAFFOLD (#417): no tokenUrl/discoverAccounts until TikTok's app is
// provisioned and the shapes are proven — the advertiser id stays required
// config, and the create path waits for a configured accountId.
const TIKTOK_PIXEL = {
  key: 'tiktok',
  label: 'TikTok Pixel',
  idLabel: 'TikTok Pixel Code',
  envVar: 'TIKTOK_ACCESS_TOKEN',
  tokenSource: 'TikTok Ads Manager → Events → Manage → Settings',
  apiKey: 'tiktokApi',
  accountLabel: 'advertiser',
};

module.exports = { META_PIXEL, TIKTOK_PIXEL };
