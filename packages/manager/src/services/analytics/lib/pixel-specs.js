/**
 * The two pixel providers, declared once — the SSOT the ensure handlers
 * (ensure/meta-pixel.js, ensure/tiktok-pixel.js) run on and the service setup
 * reads to decide whether a provider has work and needs a client at all.
 *
 * Each spec names: the config key under `analytics.providers`, the .env key
 * @omega.js/backend reads, the context key its API client rides on, and what
 * the platform calls the account the pixel lives on. `discoverAccounts` marks
 * a provider whose client can enumerate the accounts its token sees
 * (lib/pixel-account.js) — the others stay gated on a configured accountId.
 *
 * WHERE a human gets the token is NOT here: the REQUIRES registry
 * (src/config.js) owns every env descriptor — label, mint URL, hint — so the
 * shared setup contract (#608) and the preflight walkthrough read one home.
 * `acquire` names the provider whose token is MINTED rather than pasted
 * (TikTok's portal exchange, #448); without it the generic paste lane runs.
 */
const chalk = require('chalk').default;

const { acquireTikTokToken } = require('./tiktok-auth.js');

const META_PIXEL = {
  key: 'meta',
  label: 'Meta Pixel',
  idLabel: 'Meta Pixel ID',
  envVar: 'META_ACCESS_TOKEN',
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

// SCAFFOLD (#417): no discoverAccounts until TikTok's app is provisioned and
// the shapes are proven — the advertiser id stays required config, and the
// create path waits for a configured accountId. The token, though, is no
// longer a standing key: `acquire` mints it through the portal exchange (#448).
const TIKTOK_PIXEL = {
  key: 'tiktok',
  label: 'TikTok Pixel',
  idLabel: 'TikTok Pixel Code',
  envVar: 'TIKTOK_ACCESS_TOKEN',
  apiKey: 'tiktokApi',
  accountLabel: 'advertiser',
  acquire: acquireTikTokToken,
  instructions: [
    `1. Set the developer app's id at ${chalk.cyan('analytics.providers.tiktok.appId')} in omega.json5`,
    '2. Paste its app secret once — it authorizes the portal and is never saved',
    `3. The exchange runs here and saves only ${chalk.cyan('TIKTOK_ACCESS_TOKEN')}`,
  ],
};

module.exports = { META_PIXEL, TIKTOK_PIXEL };
