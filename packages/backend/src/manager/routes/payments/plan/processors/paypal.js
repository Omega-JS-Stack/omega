/**
 * PayPal plan-switch processor
 * Moves a live subscription onto a different plan via revise.
 *
 * Unlike uncancel — which PayPal has no verb for at all — revise is PayPal's
 * first-class plan change: it swaps the plan on an ACTIVE subscription and
 * prorates by its own rules. PayPal then sends BILLING.SUBSCRIPTION.UPDATED,
 * which the existing pipeline processes into the plan-changed transition.
 *
 * The plan id is resolved from config at runtime (product + frequency → the
 * matching active PayPal plan), the same resolution the checkout uses, so a
 * switch lands on exactly the plan a fresh subscription would have.
 */
module.exports = {
  /**
   * Switch a PayPal subscription to another plan
   *
   * @param {object} options
   * @param {string} options.resourceId - PayPal subscription ID (e.g., 'I-xxx')
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.product - Target product object from config
   * @param {string} options.frequency - Target billing frequency ('monthly', 'annually', …)
   * @param {object} options.ctx - Assistant instance for logging
   */
  async switchPlan({ resourceId, uid, product, frequency, ctx }) {
    const PayPalLib = require('../../../../libraries/payment/processors/paypal.js');

    const planId = await PayPalLib.resolvePlanId(product, frequency);

    await PayPalLib.request(`/v1/billing/subscriptions/${resourceId}/revise`, {
      method: 'POST',
      body: JSON.stringify({
        plan_id: planId,
      }),
    });

    ctx.log(`PayPal plan switched: sub=${resourceId}, uid=${uid}, plan=${planId} (${product.id}/${frequency})`);
  },
};
