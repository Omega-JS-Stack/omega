const isTrialing = require('../_is-trialing.js');

/**
 * PayPal cancel processor
 * Cancels a subscription — immediately if trialing, at period end otherwise.
 *
 * Note: PayPal does not have "cancel at period end" like Stripe. Cancellation
 * stops the billing agreement right away, and for a PAID subscription the
 * subscriber keeps access until the end of the period they already paid for
 * (PayPal's default behavior, and ours — the pipeline leaves the future
 * `expires` in place).
 *
 * A TRIAL is where the two part company
 * ([#267](https://github.com/Omega-JS-Stack/omega/issues/267)): access ends NOW,
 * because there is no paid-for period to serve out. PayPal exposes no second
 * cancel mode to ask for that, so the call itself is necessarily the same one —
 * the immediacy is enforced on OUR side, in the unified transform: for a
 * subscription still inside its trial window `calculatePeriodEnd()` returns null
 * (libraries/payment/processors/paypal.js), so the cancellation webhook resolves
 * the subscription to `cancelled` with nothing pending and no future expiry,
 * instead of pricing a "remaining period" off a setup-fee payment. The
 * `subscription-cancelled` transition only shapes the email that follows. The
 * branch is here so the intent is stated at the call site and the logs say which
 * cancel this was, exactly as the Stripe and Chargebee processors do.
 */
module.exports = {
  /**
   * Cancel a PayPal subscription
   *
   * @param {object} options
   * @param {string} options.resourceId - PayPal subscription ID (e.g., 'I-xxx')
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.subscription - User's current subscription object
   * @param {object} options.ctx - Assistant instance for logging
   */
  async cancelAtPeriodEnd({ resourceId, uid, subscription, ctx }) {
    const PayPalLib = require('../../../../libraries/payment/processors/paypal.js');

    const trialing = isTrialing(subscription);

    await PayPalLib.request(`/v1/billing/subscriptions/${resourceId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        reason: trialing
          ? 'Customer cancelled during free trial'
          : 'Customer requested cancellation',
      }),
    });

    if (trialing) {
      ctx.log(`PayPal cancel immediate (trialing): sub=${resourceId}, uid=${uid}`);
    } else {
      ctx.log(`PayPal cancel at period end: sub=${resourceId}, uid=${uid}`);
    }
  },
};
