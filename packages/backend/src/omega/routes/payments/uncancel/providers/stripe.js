/**
 * Stripe uncancel provider
 * Withdraws a scheduled cancellation by clearing cancel_at_period_end.
 *
 * The subscription is still live at this point — cancel_at_period_end only
 * SCHEDULES the end — so clearing the flag resumes normal renewal. Stripe then
 * sends customer.subscription.updated, which the existing pipeline processes.
 */
module.exports = {
  /**
   * Resume a Stripe subscription that is scheduled to cancel
   *
   * @param {object} options
   * @param {string} options.resourceId - Stripe subscription ID (e.g., 'sub_xxx')
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.subscription - User's current subscription object
   * @param {object} options.ctx - Assistant instance for logging
   */
  async uncancel({ resourceId, uid, ctx }) {
    const StripeLib = require('../../../../libraries/payment/providers/stripe.js');
    const stripe = StripeLib.init();

    await stripe.subscriptions.update(resourceId, { cancel_at_period_end: false });

    ctx.log(`Stripe scheduled cancellation removed: sub=${resourceId}, uid=${uid}`);
  },
};
