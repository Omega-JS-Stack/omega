/**
 * Stripe winback provider
 * Applies the save offer to a live subscription as a coupon.
 *
 * The coupon is the SAME object a checkout discount code creates — deterministic
 * id, created once, reused forever (StripeLib.resolveCoupon) — and attaching it
 * to the subscription is what makes the next invoice cheaper. A `once` coupon
 * discounts exactly the next cycle and then falls away on its own; a `forever`
 * one is the permanent cut a brand asked for in config.
 *
 * The subscription is otherwise untouched: same price, same interval, same
 * renewal date. Stripe then sends customer.subscription.updated, which the
 * existing pipeline processes.
 */
module.exports = {
  /**
   * Apply the save offer to a Stripe subscription
   *
   * @param {object} options
   * @param {string} options.resourceId - Stripe subscription ID (e.g., 'sub_xxx')
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.subscription - User's current subscription object
   * @param {object} options.discount - The offer as a discount-codes validate() result
   * @param {object} options.ctx - Assistant instance for logging
   */
  async applyOffer({ resourceId, uid, discount, ctx }) {
    const StripeLib = require('../../../../libraries/payment/providers/stripe.js');
    const stripe = StripeLib.init();

    const couponId = await StripeLib.resolveCoupon(discount, ctx);

    // `discounts` REPLACES every discount already on the subscription — it is
    // the whole list, not an addition — so an existing coupon (a retention
    // credit, an earlier offer) is dropped when this one lands.
    await stripe.subscriptions.update(resourceId, {
      discounts: [{ coupon: couponId }],
    });

    ctx.log(`Stripe winback offer applied: sub=${resourceId}, uid=${uid}, coupon=${couponId}`);
  },
};
