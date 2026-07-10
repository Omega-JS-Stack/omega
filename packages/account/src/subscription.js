/**
 * resolveSubscription — extracted verbatim from @omegajs/backend's User.resolveSubscription
 * (the superset: web-manager's drifted copy lacked `everPaid`).
 *
 * Resolves calculated subscription fields that require derivation logic.
 * Raw data (product.id, status, trial, cancellation) is on the account directly.
 * Returns: { plan, active, trialing, cancelling, everPaid }
 * - plan: the plan ID the user effectively has access to RIGHT NOW ('basic' if cancelled/suspended)
 * - active: user has active access (active, trialing, or cancelling)
 * - trialing: user is in an active trial (status is 'active' but trial hasn't expired)
 * - cancelling: cancellation is pending (status is 'active' but cancellation.pending is true)
 * - everPaid: user has had a paid subscription at some point (payment.startDate exists)
 */
function resolveSubscription(account) {
  const subscription = (account?.subscription || account?.properties?.subscription) || {};
  const productId = subscription.product?.id || 'basic';

  let trialing = false;
  let cancelling = false;

  if (productId !== 'basic' && subscription.status === 'active') {
    trialing = !!(subscription.trial?.claimed
      && subscription.trial?.expires?.timestampUNIX > Math.floor(Date.now() / 1000));
    cancelling = !trialing && !!subscription.cancellation?.pending;
  }

  const active = (productId !== 'basic' && subscription.status === 'active');

  return {
    plan: active ? productId : 'basic',
    active,
    trialing,
    cancelling,
    everPaid: (subscription.payment?.startDate?.timestampUNIX || 0) > 0,
  };
}

module.exports = resolveSubscription;
