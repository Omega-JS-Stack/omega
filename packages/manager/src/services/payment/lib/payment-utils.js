/**
 * Shared helpers for the payment operations — the paid-product filter, the
 * processor-facing product identity (display name + image), the backend
 * webhook URL, and the event-set diff. omega-manager duplicated these across
 * the stripe/paypal/chargebee handlers (and hardcoded the company CDN for
 * product images — the image is brand.images.brandmark config now).
 */
const { absoluteBrandImage } = require('../../../lib/brand.js');

/**
 * Products the processors manage: priced and not archived. Free tiers have
 * no prices; archived products keep their processor objects but stop being
 * reconciled.
 *
 * @param {Object} brandConfig - Merged brand config
 * @returns {Array} Paid, non-archived products
 */
function paidProducts(brandConfig) {
  return (brandConfig.payment?.products || []).filter((p) => p.prices && !p.archived);
}

/**
 * The processor-facing product name: "{Brand} - {Product}".
 *
 * @param {Object} brandConfig - Merged brand config
 * @param {Object} product - Product entry from payment.products
 * @returns {string} Display name
 */
function productDisplayName(brandConfig, product) {
  return `${brandConfig.brand.name} - ${product.name}`;
}

/**
 * The product image URL — brand.images.brandmark when configured, else null
 * (processors keep whatever image they have; the diff skips images entirely).
 *
 * @param {Object} brandConfig - Merged brand config
 * @returns {string|null} Image URL or null
 */
function productImage(brandConfig) {
  return absoluteBrandImage(brandConfig, 'brandmark');
}

/**
 * The brand backend's payment webhook URL for a processor.
 * Requires OMEGA_WEBHOOK_KEY in the brand .env.
 *
 * @param {Object} brandConfig - Merged brand config
 * @param {string} processor - 'stripe' | 'paypal' | 'chargebee'
 * @param {string} [brandId] - Included as &brand= (chargebee only)
 * @returns {string} Webhook URL
 */
function buildWebhookUrl(brandConfig, processor, brandId) {
  const domain = brandConfig.brand.url.replace(/^https?:\/\//, '');
  const key = process.env.OMEGA_WEBHOOK_KEY;
  const brandParam = brandId ? `&brand=${brandId}` : '';

  return `https://api.${domain}/omega/payments/webhook?processor=${processor}${brandParam}&key=${key}`;
}

/**
 * Webhook URL with the key query param redacted — the ONLY form safe to print
 * (campaigns/newsletter build the same URL and never print it at all).
 *
 * @param {string} url - A buildWebhookUrl() result
 * @returns {string} URL with key=***
 */
function redactWebhookUrl(url) {
  return url.replace(/([?&]key=)[^&]*/, '$1***');
}

/**
 * Diff current webhook events against desired.
 *
 * @param {string[]} currentEvents - Events on the endpoint now
 * @param {string[]} desiredEvents - Events the backend handles
 * @returns {{ missing: string[], extra: string[] }|null} Diff, or null when converged
 */
function diffEventSets(currentEvents, desiredEvents) {
  const currentSet = new Set(currentEvents);
  const desiredSet = new Set(desiredEvents);

  const missing = desiredEvents.filter((e) => !currentSet.has(e));
  const extra = [...currentSet].filter((e) => !desiredSet.has(e));

  return (missing.length > 0 || extra.length > 0)
    ? { missing, extra }
    : null;
}

module.exports = { paidProducts, productDisplayName, productImage, buildWebhookUrl, redactWebhookUrl, diffEventSets };
