const isTrialing = require('../_is-trialing.js');

/**
 * Stripe cancel processor
 * Cancels a subscription — immediately if trialing, at period end otherwise.
 */
module.exports = {
  /**
   * Cancel a Stripe subscription
   *
   * If the subscription is currently trialing, cancel immediately to avoid
   * giving free premium access for the remainder of the trial.
   * Otherwise, cancel at the end of the current billing period.
   *
   * @param {object} options
   * @param {string} options.resourceId - Stripe subscription ID (e.g., 'sub_xxx')
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.subscription - User's current subscription object
   * @param {object} options.ctx - Assistant instance for logging
   */
  async cancelAtPeriodEnd({ resourceId, uid, subscription, ctx }) {
    const StripeLib = require('../../../../libraries/payment/processors/stripe.js');
    const stripe = StripeLib.init();

    if (isTrialing(subscription)) {
      await stripe.subscriptions.cancel(resourceId);
      ctx.log(`Stripe cancel immediate (trialing): sub=${resourceId}, uid=${uid}`);
    } else {
      await stripe.subscriptions.update(resourceId, { cancel_at_period_end: true });
      ctx.log(`Stripe cancel at period end: sub=${resourceId}, uid=${uid}`);
    }
  },
};
