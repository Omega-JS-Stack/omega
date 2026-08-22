/**
 * Ensure the Meta Pixel EXISTS and is configured with a Conversions API
 * access token (META_ACCESS_TOKEN in the brand .env — the name
 * @omega.js/backend reads, and the same system-user token the Marketing API
 * create authenticates with).
 *
 * Near-zero input (#417, Ian 2026-08-21): one interactive pass acquires the
 * token (Enter-gated open of the system-users page, then a paste-in),
 * discovers the ad account that token can see (auto-selected when there's
 * exactly one, landed in `analytics.providers.meta.accountId`), creates the
 * pixel on it, and lands its id — so a brand configures Meta by saying Yes.
 * `analytics.providers.meta: false` turns the whole thing off.
 */
const { ensurePixelToken } = require('../lib/pixel-token.js');
const { provisionPixel } = require('../lib/pixel-provision.js');
const { META_PIXEL } = require('../lib/pixel-specs.js');

module.exports = async function ensureMetaPixel(context) {
  const ended = await provisionPixel(context, META_PIXEL);

  return ended || ensurePixelToken(context, META_PIXEL);
};
