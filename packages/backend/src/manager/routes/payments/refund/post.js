const path = require('path');
const loadProcessor = require('../../../libraries/load-processor.js');
const powertools = require('node-powertools');

/**
 * POST /payments/refund
 * Refunds the authenticated user's subscription and cancels it immediately.
 * Requires the subscription to be cancelled or pending cancellation first.
 *
 * Delegates to the processor (e.g., Stripe) to issue the refund and cancel.
 * The resulting webhook triggers the Firestore pipeline which updates subscription state
 * and fires the subscription-cancelled transition handler.
 * Stores the refund reason/feedback on payments-orders/{orderId}.requests.refund.
 * Requires authentication.
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
    return ctx.respond('Refund must be confirmed', { code: 400 });
  }

  const subscription = user.subscription;

  // Require a paid subscription
  if (!subscription || subscription.product?.id === 'basic') {
    ctx.log(`Refund rejected: uid=${uid}, no paid subscription`);
    return ctx.respond('No paid subscription found', { code: 400 });
  }

  // Require cancelled or pending cancellation — cannot refund an active subscription
  const isCancelled = subscription.status === 'cancelled';
  const isPendingCancel = subscription.cancellation?.pending === true;

  if (!isCancelled && !isPendingCancel) {
    ctx.log(`Refund rejected: uid=${uid}, status=${subscription.status}, pending=${subscription.cancellation?.pending}`);
    return ctx.respond('Subscription must be cancelled or pending cancellation before requesting a refund', { code: 400 });
  }

  // Reject if the most recent payment is older than 6 months
  const startDateUNIX = subscription.payment?.startDate?.timestampUNIX
    || subscription.payment?.updatedBy?.date?.timestampUNIX;

  if (startDateUNIX) {
    const sixMonthsAgoUNIX = Math.floor(Date.now() / 1000) - (6 * 30 * 24 * 60 * 60);

    if (startDateUNIX < sixMonthsAgoUNIX) {
      ctx.log(`Refund rejected: uid=${uid}, payment too old (startDate=${new Date(startDateUNIX * 1000).toISOString()})`);
      return ctx.respond('Payments older than 6 months are not eligible for refunds', { code: 400 });
    }
  }

  const processor = subscription.payment?.processor;
  const resourceId = subscription.payment?.resourceId;

  if (!processor || !resourceId) {
    ctx.log(`Refund rejected: uid=${uid}, missing processor=${processor} or resourceId=${resourceId}`);
    return ctx.respond('Subscription payment details not found', { code: 400 });
  }

  // Load the processor module
  let processorModule;
  try {
    processorModule = loadProcessor(path.join(__dirname, 'processors'), processor);
  } catch (e) {
    return ctx.respond(`Unknown processor: ${processor}`, { code: 400 });
  }

  // Process the refund via the processor
  let refund;
  try {
    refund = await processorModule.processRefund({ resourceId, uid, subscription, ctx });
  } catch (e) {
    // The processor's own words stay in the logs — a client gets one neutral
    // sentence, never an SDK message naming our internals ([#212]).
    ctx.error(`Failed to process refund via ${processor}: uid=${uid}, sub=${resourceId}, error=${e.message}`);
    return ctx.respond('We could not process your refund right now. Please try again shortly.', { code: 500 });
  }

  // Store refund reason/feedback on the order doc
  const orderId = subscription.payment?.orderId;

  if (orderId) {
    const admin = ctx.Manager.libraries.admin;
    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });

    await admin.firestore().doc(`payments-orders/${orderId}`).set({
      requests: {
        refund: {
          reason: settings.reason || null,
          feedback: settings.feedback || null,
          amount: refund.amount,
          full: refund.full,
          date: {
            timestamp: now,
            timestampUNIX: nowUNIX,
          },
        },
      },
    }, { merge: true });

    ctx.log(`Stored refund request on payments-orders/${orderId}: reason=${settings.reason}, amount=${refund.amount}`);
  }

  ctx.log(`Refund processed: uid=${uid}, processor=${processor}, sub=${resourceId}, amount=${refund.amount}, full=${refund.full}, reason=${settings.reason}`);

  return ctx.respond({ success: true, refund });
};
