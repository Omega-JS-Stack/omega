/**
 * Coinbase Commerce intent provider
 * Creates a hosted CHARGE and hands back the page the buyer pays it on
 *
 * ONE-TIME ONLY ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)):
 * a Coinbase Commerce charge is a single payment at a single price. There is no
 * subscription, plan or billing agreement in this API, so a subscription product
 * is refused here rather than half-sold — the checkout hides the crypto button
 * on a plan for the same reason.
 */
const { chargeableAmount } = require('../../../../libraries/payment/discount-codes.js');

module.exports = {
  /**
   * Create a Coinbase Commerce payment intent (a hosted charge)
   *
   * @param {object} options
   * @param {string} options.uid - User's UID
   * @param {string} options.orderId - Internal order ID
   * @param {object} options.product - Full product object from config
   * @param {string} options.productId - Product ID from config (e.g., 'launch-kit')
   * @param {object} options.discount - Validated discount result, or null
   * @param {string} options.confirmationUrl - Success redirect URL
   * @param {string} options.cancelUrl - Cancel redirect URL
   * @param {object} options.ctx - Assistant instance for logging
   * @returns {object} { id, url, raw }
   */
  async createIntent({ uid, orderId, product, productId, discount, confirmationUrl, cancelUrl, ctx }) {
    const CoinbaseLib = require('../../../../libraries/payment/providers/coinbase.js');

    const productType = product.type || 'subscription';

    if (productType !== 'one-time') {
      throw new Error(`Coinbase Commerce cannot sell ${product.id}: a crypto charge is a one-time payment and this product is a ${productType}`);
    }

    if (product.archived) {
      throw new Error(`Product ${product.id} is archived`);
    }

    const listPrice = product.prices?.once;

    if (!listPrice) {
      throw new Error(`No one-time price configured for ${product.id}`);
    }

    // The charge is a FIXED price we compute, so a validated coupon has to come
    // off here: a real provider applies it on its own hosted page, and Coinbase
    // has no coupon object at all. Leaving it out would charge the full amount
    // in crypto while the confirmation page — which discounts the same way, in
    // routes/payments/intent/post.js — reported the discounted one. A code that
    // covers the whole price is refused by that same helper before this charge
    // is ever created: Coinbase Commerce does not take a $0.00 one
    // ([#786](https://github.com/Omega-JS-Stack/omega/issues/786)).
    const amount = chargeableAmount(listPrice, discount, { provider: 'Coinbase Commerce' });

    const brandName = ctx.Manager?.config?.brand?.name || product.name || productId;

    const chargeParams = {
      name: product.name || productId,
      description: product.description || brandName,
      pricing_type: 'fixed_price',
      local_price: {
        amount: amount.toFixed(2),
        currency: 'USD',
      },
      // Coinbase Commerce metadata is a flat string map, and it is the ONLY place
      // this purchase's identifiers live — the webhook pipeline reads uid and
      // orderId back off the charge it looks up
      metadata: CoinbaseLib.buildMetadata(uid, orderId, productId),
      redirect_url: confirmationUrl,
      cancel_url: cancelUrl,
    };

    const result = await CoinbaseLib.request('/charges', {
      method: 'POST',
      body: chargeParams,
    });

    const charge = result.data || result;

    if (!charge.hosted_url) {
      throw new Error('Coinbase Commerce charge created but no hosted_url returned');
    }

    ctx.log(`Coinbase charge created: id=${charge.id}, code=${charge.code}, amount=${chargeParams.local_price.amount}, url=${charge.hosted_url}`);

    return {
      id: charge.id,
      url: charge.hosted_url,
      raw: charge,
    };
  },
};
