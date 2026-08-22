/**
 * Ensure the TikTok Pixel EXISTS (created on `analytics.providers.tiktok
 * .accountId` — the advertiser account — when config has no id yet) and is
 * configured with an Events API access token (TIKTOK_ACCESS_TOKEN in the
 * brand .env — the name @omega.js/backend reads, and the same token the
 * Business API create authenticates with).
 *
 * SCAFFOLD (#417, Ian 2026-08-21): the wiring is complete and the token is
 * the gate, but TikTok's side is not provisioned — no brand carries the key,
 * so the create path has never run against the live API and this pass always
 * ends at the warned where-to-get guidance. lib/tiktok-api.js carries the
 * call shapes it will use on the first real run.
 */
const { ensurePixelToken } = require('../lib/pixel-token.js');
const { provisionPixel } = require('../lib/pixel-provision.js');
const { TIKTOK_PIXEL } = require('../lib/pixel-specs.js');

module.exports = async function ensureTikTokPixel(context) {
  const ended = await provisionPixel(context, TIKTOK_PIXEL);

  return ended || ensurePixelToken(context, TIKTOK_PIXEL);
};
