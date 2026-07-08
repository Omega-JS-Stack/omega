/**
 * Ensure the TikTok Pixel is configured with an Events API access token
 * (TIKTOK_ACCESS_TOKEN in the brand .env — the name backend-manager reads).
 */
const { ensurePixelToken } = require('../lib/pixel-token.js');

module.exports = async function ensureTikTokPixel(context) {
  return ensurePixelToken(context, {
    key: 'tiktok',
    label: 'TikTok Pixel',
    idLabel: 'TikTok Pixel Code',
    envVar: 'TIKTOK_ACCESS_TOKEN',
    tokenSource: 'TikTok Ads Manager → Events → Manage → Settings',
  });
};
