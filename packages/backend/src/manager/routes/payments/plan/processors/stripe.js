/**
 * Stripe plan-switch processor
 * Moves a live subscription onto a different price, prorating the difference.
 *
 * Stripe swaps plans by updating the subscription's ITEM: the existing item's id
 * has to be sent alongside the new price, or Stripe adds a second item instead of
 * replacing the first. proration_behavior 'create_prorations' credits the unused
 * part of the current period and charges the new plan pro rata on the next
 * invoice. Stripe then sends customer.subscription.updated, which the existing
 * pipeline processes into the plan-changed transition.
 */
module.exports = {
  /**
   * Switch a Stripe subscription to another plan
   *
   * @param {object} options
   * @param {string} options.resourceId - Stripe subscription ID (e.g., 'sub_xxx')
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.product - Target product object from config
   * @param {string} options.productType - Target product type ('subscription')
   * @param {string} options.frequency - Target billing frequency ('monthly', 'annually', …)
   * @param {object} options.ctx - Assistant instance for logging
   */
  async switchPlan({ resourceId, uid, product, productType, frequency, ctx }) {
    const StripeLib = require('../../../../libraries/payment/processors/stripe.js');
    const stripe = StripeLib.init();

    const priceId = await StripeLib.resolvePriceId(product, productType, frequency);

    // The item being replaced — read from the live subscription, never assumed
    const current = await stripe.subscriptions.retrieve(resourceId);
    const itemId = current.items?.data?.[0]?.id;

    if (!itemId) {
      throw new Error(`Stripe subscription ${resourceId} has no subscription item to update`);
    }

    await stripe.subscriptions.update(resourceId, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: 'create_prorations',
    });

    ctx.log(`Stripe plan switched: sub=${resourceId}, uid=${uid}, item=${itemId}, price=${priceId} (${product.id}/${frequency})`);
  },
};
