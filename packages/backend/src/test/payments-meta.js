/**
 * The `payments` ctx extra of the backend `emulator` layer: product metadata
 * precomputed from the brand config, the one source every product-aware case
 * reads (`payments.products[id].*`) instead of recomputing it per case.
 */

const FREQ_TO_INTERVAL = { daily: 'day', weekly: 'week', monthly: 'month', annually: 'year' };

/**
 * Each product's stripeProductId, frequency, interval and price, resolved from config.
 * @param {object} config - The test config (`payment.products`)
 * @returns {{ stripeProductIds: object, products: object }} Both keyed by product id
 */
function paymentsMeta(config) {
  const products = config.payment?.products || [];
  const stripeProductIds = Object.fromEntries(
    products.map((p) => [p.id, p.stripe?.productId || `_test_${p.id}`])
  );
  const productMeta = Object.fromEntries(
    products.map((p) => {
      const freq = p.prices ? Object.keys(p.prices)[0] : null;
      return [p.id, {
        id: p.id,
        name: p.name,
        type: p.type,
        stripeProductId: p.stripe?.productId || `_test_${p.id}`,
        frequency: freq,
        interval: FREQ_TO_INTERVAL[freq] || null,
        price: freq ? p.prices[freq] : 0,
        trial: p.trial || null,
      }];
    })
  );

  return { stripeProductIds, products: productMeta };
}

module.exports = { paymentsMeta };
