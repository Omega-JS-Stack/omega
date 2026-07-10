/**
 * Ensure the Meta Pixel is configured with a Conversions API access token
 * (META_ACCESS_TOKEN in the brand .env — the name @omegajs/backend reads).
 */
const { ensurePixelToken } = require('../lib/pixel-token.js');

module.exports = async function ensureMetaPixel(context) {
  return ensurePixelToken(context, {
    key: 'meta',
    label: 'Meta Pixel',
    idLabel: 'Meta Pixel ID',
    envVar: 'META_ACCESS_TOKEN',
    tokenSource: 'Meta Business Suite → Events Manager → Settings → Conversions API',
  });
};
