/**
 * Transition: checkout-declined
 * Triggered when a FIRST checkout's payment is declined (basic/null → suspended)
 *
 * Log-only, deliberately. This user is standing at the checkout watching the
 * decline happen — the payment-failed email this case used to send is renewal
 * dunning copy ("your access has been suspended", "update your payment method to
 * restore access") addressed to someone who never had access to lose. No analytics
 * either: no money moved, and the resolver tracks payments, not attempts ([#212]).
 */
module.exports = async function ({ before, after, order, uid, ctx }) {
  ctx.log(`Transition [subscription/checkout-declined]: uid=${uid}, attemptedProduct=${after.product?.id}, previousProduct=${before?.product?.id || 'none'}, order=${order?.id || 'none'} (no email — the user is at checkout and sees the decline)`);
};
