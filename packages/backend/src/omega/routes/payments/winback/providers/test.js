/**
 * Test winback provider
 * Applies the save offer the way the real ones do: to the PROVIDER, not to us.
 *
 * The other test providers write a payments-webhooks doc, because the thing
 * they simulate changes subscription state and the pipeline is what writes it.
 * A coupon changes none: the plan, the cadence and the renewal date all stay
 * exactly as they were, and the only thing that moves is the next invoice, which
 * this framework does not model. Minting a webhook here would put an event
 * through the pipeline that resolves to no transition at all — noise that reads
 * like a bug the first time someone finds it in the logs.
 *
 * So this provider does what Stripe's does to OUR data, which is nothing, and
 * says so. A local QA run through `_dev_cardProvider=test` still proves the
 * whole flow end to end — the gate, the dialog, the route's guards, the claim
 * written on payments-orders/{orderId} — against exactly the data a real
 * provider leaves behind
 * ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * Only available in non-production environments.
 */
module.exports = {
  /**
   * Apply the save offer to a test subscription
   *
   * @param {object} options
   * @param {string} options.resourceId - Test subscription ID
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.subscription - User's current subscription object
   * @param {object} options.discount - The offer as a discount-codes validate() result
   * @param {object} options.ctx - Assistant instance for logging
   */
  async applyOffer({ resourceId, uid, discount, ctx }) {
    if (ctx.isProduction()) {
      throw new Error('Test provider is not available in production');
    }

    const off = discount.amount > 0 ? `${discount.amount} off` : `${discount.percent}%`;

    ctx.log(`Test winback provider: applied ${discount.code} (${off}, ${discount.duration}) to sub=${resourceId}, uid=${uid}`);
  },
};
