const path = require('path');
const loadProcessor = require('../../../libraries/load-processor.js');
const powertools = require('node-powertools');

/**
 * POST /payments/cancel
 * Cancels the authenticated user's subscription at the end of the current billing period.
 * Delegates to the processor (e.g., Stripe) to set cancel_at_period_end=true.
 * The resulting webhook triggers the Firestore pipeline which updates subscription state
 * and fires the cancellation-requested transition handler.
 * Stores the cancellation reason/feedback on payments-orders/{orderId}.requests.cancellation.
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
    return ctx.respond('Cancellation must be confirmed', { code: 400 });
  }

  const subscription = user.subscription;

  // Require an active or suspended paid subscription
  if (!subscription || (subscription.status !== 'active' && subscription.status !== 'suspended') || subscription.product?.id === 'basic') {
    ctx.log(`Cancel rejected: uid=${uid}, status=${subscription?.status}, product=${subscription?.product?.id}`);
    return ctx.respond('No active paid subscription found', { code: 400 });
  }

  // Guard: subscription younger than 24 hours (callers may bypass via skipGuards)
  const startDateUNIX = subscription.payment?.startDate?.timestampUNIX;
  if (!settings.skipGuards && startDateUNIX) {
    const ageMs = Date.now() - (startDateUNIX * 1000);
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    if (ageMs < twentyFourHoursMs) {
      ctx.log(`Cancel rejected: uid=${uid}, subscription is only ${Math.round(ageMs / 1000 / 60)} minutes old`);
      return ctx.respond('Your subscription is still being set up. Please try again after 24-48 hours.', { code: 400 });
    }
  }

  // Guard: already pending cancellation
  if (subscription.cancellation?.pending === true) {
    ctx.log(`Cancel rejected: uid=${uid}, cancellation already pending`);
    return ctx.respond('Subscription is already pending cancellation', { code: 400 });
  }

  const processor = subscription.payment?.processor;
  const resourceId = subscription.payment?.resourceId;

  if (!processor || !resourceId) {
    ctx.log(`Cancel rejected: uid=${uid}, missing processor=${processor} or resourceId=${resourceId}`);
    return ctx.respond('Subscription payment details not found', { code: 400 });
  }

  // Load the processor module
  let processorModule;
  try {
    processorModule = loadProcessor(path.join(__dirname, 'processors'), processor);
  } catch (e) {
    return ctx.respond(`Unknown processor: ${processor}`, { code: 400 });
  }

  // Cancel at period end via the processor
  try {
    await processorModule.cancelAtPeriodEnd({ resourceId, uid, subscription, ctx });
  } catch (e) {
    // If the subscription is suspended and the processor rejects (subscription already dead/gone),
    // directly reset the user's subscription to cancelled so they can re-subscribe
    if (subscription.status === 'suspended') {
      ctx.log(`Processor cancel failed for suspended subscription (${e.message}), resetting directly`);
      const admin = ctx.Manager.libraries.admin;
      const now = powertools.timestamp(new Date(), { output: 'string' });
      const nowUNIX = powertools.timestamp(now, { output: 'unix' });

      await admin.firestore().doc(`users/${uid}`).set({
        subscription: {
          status: 'cancelled',
          product: { id: 'basic', name: 'Basic' },
          cancellation: { pending: false, date: { timestamp: now, timestampUNIX: nowUNIX } },
        },
      }, { merge: true });

      ctx.log(`Directly cancelled suspended subscription for uid=${uid}`);
      return ctx.respond({ success: true });
    }

    ctx.log(`Failed to cancel subscription via ${processor}: ${e.message}`);
    return ctx.respond(`Failed to cancel subscription: ${e.message}`, { code: 500 });
  }

  // Store cancellation reason/feedback on the order doc
  const orderId = subscription.payment?.orderId;

  if (orderId) {
    const admin = ctx.Manager.libraries.admin;
    const now = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(now, { output: 'unix' });

    await admin.firestore().doc(`payments-orders/${orderId}`).set({
      requests: {
        cancellation: {
          reason: settings.reason || null,
          feedback: settings.feedback || null,
          date: {
            timestamp: now,
            timestampUNIX: nowUNIX,
          },
        },
      },
    }, { merge: true });

    ctx.log(`Stored cancellation request on payments-orders/${orderId}: reason=${settings.reason}`);
  }

  ctx.log(`Cancel scheduled: uid=${uid}, processor=${processor}, sub=${resourceId}, reason=${settings.reason}`);

  return ctx.respond({ success: true });
};
