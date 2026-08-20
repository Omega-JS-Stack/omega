/**
 * TikTok adapter — the TikTok Pixel and the Events API.
 *
 * TikTok's commerce vocabulary is single-item (content_id + price + quantity),
 * so those entries carry a `map()` in the catalog; everything else passes
 * through as properties. Consent category: 'marketing'.
 */

const { createAdapter, pick } = require('./resolve.js');

// TikTok's click id and cookie live in the Events API's context.user block —
// never in the event properties.
const ATTRIBUTION_KEYS = ['ttclid', 'ttp'];

const adapter = createAdapter({
  provider: 'tiktok',
  consentCategory: 'marketing',
  attach: (descriptor, attribution) => {
    Object.assign(descriptor.userData, pick(attribution, ATTRIBUTION_KEYS));
  },
});

module.exports = adapter;
module.exports.ATTRIBUTION_KEYS = ATTRIBUTION_KEYS;
