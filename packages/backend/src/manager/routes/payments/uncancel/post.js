const path = require('path');
const loadProcessor = require('../../../libraries/load-processor.js');

/**
 * POST /payments/uncancel
 * Withdraws a scheduled cancellation, so the authenticated user's subscription
 * renews as normal instead of ending at the close of the current billing period.
 * Delegates to the processor (e.g., Stripe) to clear cancel_at_period_end.
 * The resulting webhook triggers the Firestore pipeline which updates subscription
 * state — this route writes no subscription state of its own, exactly like cancel.
 * Clears the cancellation request on payments-orders/{orderId}.requests.cancellation.
 * Requires authentication.
 *
 * Cross-provider and CAPABILITY-GATED: a processor that can resume a subscription
 * exports uncancel(), one that cannot simply lacks the export, and the route
 * refuses before dispatch rather than letting the caller discover it as a provider
 * error ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 */
module.exports = async ({ ctx, user, settings }) => {
  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  const uid = user.auth.uid;
  const confirmed = settings.confirmed;

  // Require explicit confirmation
  if (!confirmed) {
    return ctx.respond('Resuming the subscription must be confirmed', { code: 400 });
  }

  const subscription = user.subscription;

  // Require an ACTIVE paid subscription — a suspended or already-ended term
  // cannot be resumed by clearing a scheduled cancellation
  if (!subscription || subscription.status !== 'active' || subscription.product?.id === 'basic') {
    ctx.log(`Uncancel rejected: uid=${uid}, status=${subscription?.status}, product=${subscription?.product?.id}`);
    return ctx.respond('No active paid subscription found', { code: 400 });
  }

  // Require a cancellation actually scheduled — there is nothing else to withdraw
  if (subscription.cancellation?.pending !== true) {
    ctx.log(`Uncancel rejected: uid=${uid}, no cancellation pending`);
    return ctx.respond('Your subscription is not scheduled to cancel', { code: 400 });
  }

  const processor = subscription.payment?.processor;
  const resourceId = subscription.payment?.resourceId;

  if (!processor || !resourceId) {
    ctx.log(`Uncancel rejected: uid=${uid}, missing processor=${processor} or resourceId=${resourceId}`);
    return ctx.respond('Subscription payment details not found', { code: 400 });
  }

  // Load the processor module
  let processorModule;
  try {
    processorModule = loadProcessor(path.join(__dirname, 'processors'), processor);
  } catch (e) {
    return ctx.respond(`Unknown processor: ${processor}`, { code: 400 });
  }

  // The capability gate. A missing export is the processor saying it cannot do
  // this at all — a CLIENT fault to be branched on, not an outage to retry, so
  // the code rides the response properties where every 4xx carries its
  // machine-readable half, and the sentence points at the fallback that works.
  if (typeof processorModule.uncancel !== 'function') {
    ctx.log(`Uncancel not supported: uid=${uid}, processor=${processor}`);
    return ctx.respond('Your payment provider cannot resume a cancelled subscription. Please use the billing portal to manage your subscription.', {
      code: 400,
      additional: { code: 'not-supported-by-processor' },
    });
  }

  // Clear the scheduled cancellation via the processor
  try {
    await processorModule.uncancel({ resourceId, uid, subscription, ctx });
  } catch (e) {
    // The processor's own words stay in the logs — a client gets one neutral
    // sentence, never an SDK message naming our internals ([#212]).
    ctx.error(`Failed to resume subscription via ${processor}: uid=${uid}, sub=${resourceId}, error=${e.message}`);
    return ctx.respond('We could not resume your subscription right now. Please try again shortly.', { code: 500 });
  }

  // Clear the cancellation request on the order doc — the request is withdrawn,
  // so leaving the reason/feedback behind would misreport the order's state.
  // Null is the same empty shape the pipeline initializes an order with.
  const orderId = subscription.payment?.orderId;

  if (orderId) {
    const admin = ctx.Manager.libraries.admin;

    await admin.firestore().doc(`payments-orders/${orderId}`).set({
      requests: {
        cancellation: null,
      },
    }, { merge: true });

    ctx.log(`Cleared cancellation request on payments-orders/${orderId}`);
  }

  ctx.log(`Cancellation withdrawn: uid=${uid}, processor=${processor}, sub=${resourceId}`);

  return ctx.respond({ success: true });
};
