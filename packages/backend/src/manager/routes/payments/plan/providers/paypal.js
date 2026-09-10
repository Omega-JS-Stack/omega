/**
 * PayPal plan-switch provider
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
 *
 * Trials ([#237]): revise takes no trial parameter, so unlike Stripe and
 * Chargebee there is nothing to restate here. PayPal exposes no trial dates at
 * all — the library derives them from the PLAN's `TRIAL` billing cycle anchored
 * to the subscription's original `start_time` — so a revise cannot extend a
 * trial past what it would have been from day one. It can still shift the end
 * date when the target plan's trial is a different LENGTH; a brand that prices
 * unequal trials on PayPal needs the plans reconciled, not this route patched.
 *
 * Which is why the plan lookup is asked for a TWIN ([#761]): a trial product
 * carries one plan with the TRIAL cycle and one without, so a switcher still
 * inside a trial has to land on the trial twin to carry that trial over, and a
 * PAYING switcher has to land on the twin with no free cycle on it — landing
 * a paying subscriber on a trial plan would read them as trialing everywhere
 * the backend asks.
 */
const isTrialing = require('../../cancel/_is-trialing.js');

module.exports = {
  /**
   * Switch a PayPal subscription to another plan
   *
   * @param {object} options
   * @param {string} options.resourceId - PayPal subscription ID (e.g., 'I-xxx')
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.subscription - The user's current subscription (picks the trial twin)
   * @param {object} options.product - Target product object from config
   * @param {string} options.frequency - Target billing frequency ('monthly', 'annually', …)
   * @param {object} options.ctx - Assistant instance for logging
   */
  async switchPlan({ resourceId, uid, subscription, product, frequency, ctx }) {
    const PayPalLib = require('../../../../libraries/payment/providers/paypal.js');

    // The twin is a property of the TARGET product: a trial-less product has
    // no trial twin to carry a trial over to, so a switcher mid-trial lands on
    // its one plan (the trial ends, as the header says it may) instead of a
    // lookup for a plan no manage run will ever mint
    const carryTrial = isTrialing(subscription) && !!product.trial?.days;
    const planId = await PayPalLib.resolvePlanId(product, frequency, carryTrial);

    await PayPalLib.request(`/v1/billing/subscriptions/${resourceId}/revise`, {
      method: 'POST',
      body: JSON.stringify({
        plan_id: planId,
      }),
    });

    ctx.log(`PayPal plan switched: sub=${resourceId}, uid=${uid}, plan=${planId} (${product.id}/${frequency})`);
  },
};
