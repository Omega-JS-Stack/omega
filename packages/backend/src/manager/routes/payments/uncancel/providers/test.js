const powertools = require('node-powertools');

/**
 * Test uncancel provider
 * Simulates the Stripe webhook that results from withdrawing a scheduled
 * cancellation by writing directly to payments-webhooks/{eventId} with
 * status=pending. The on-write trigger picks it up and runs the full pipeline.
 *
 * The event is customer.subscription.updated carrying cancel_at_period_end=false
 * and cancel_at=null — the shape Stripe sends once the schedule is cleared, which
 * the unified transform reads back as cancellation.pending=false.
 *
 * Only available in non-production environments.
 */
module.exports = {
  async uncancel({ resourceId, uid, subscription, ctx }) {
    if (ctx.isProduction()) {
      throw new Error('Test provider is not available in production');
    }

    const admin = ctx.Manager.libraries.admin;

    const timestamp = Date.now();
    const now = Math.floor(timestamp / 1000);
    const periodEnd = subscription?.expires?.timestampUNIX || (now + (30 * 86400));

    // Look up the Stripe product ID for the plan so resolveProduct() can match.
    // The order doc is the first source; when there is no order the subscription's
    // own product is the fallback — without it the plan carries product=null and
    // the pipeline downgrades the user to Basic instead of resuming their plan.
    const orderId = subscription?.payment?.orderId;
    let productId = null;

    if (orderId) {
      const orderDoc = await admin.firestore().doc(`payments-orders/${orderId}`).get();
      if (orderDoc.exists) {
        productId = orderDoc.data().unified?.product?.id || null;
      }
    }

    productId = productId || subscription?.product?.id || null;

    // Falls back to the "_test_<id>" sentinel when no real Stripe product is configured.
    const products = ctx.Manager.config.payment?.products || [];
    const product = products.find(p => p.id === productId);
    const stripeProductId = product
      ? (product.stripe?.productId || `_test_${product.id}`)
      : null;

    // Carry the subscription's OWN billing frequency through: resuming a
    // subscription must never quietly re-bill it on a different interval.
    const FREQUENCY_TO_INTERVAL = { annually: 'year', monthly: 'month', weekly: 'week', daily: 'day' };
    const interval = FREQUENCY_TO_INTERVAL[subscription?.payment?.frequency] || 'month';

    const eventType = 'customer.subscription.updated';
    const eventId = `_test-evt-uncancel-${timestamp}`;

    const subscriptionObj = {
      id: resourceId,
      object: 'subscription',
      status: 'active',
      metadata: { uid, orderId },
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      current_period_end: periodEnd,
      current_period_start: now - (30 * 86400),
      start_date: subscription?.payment?.startDate?.timestampUNIX || (now - (30 * 86400)),
      trial_start: null,
      trial_end: null,
      plan: { product: stripeProductId, interval: interval },
    };

    const nowTs = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(nowTs, { output: 'unix' });

    // Write directly to payments-webhooks — on-write trigger handles the rest
    await admin.firestore().doc(`payments-webhooks/${eventId}`).set({
      id: eventId,
      provider: 'test',
      status: 'pending',
      owner: uid,
      raw: {
        id: eventId,
        type: eventType,
        data: { object: subscriptionObj },
      },
      event: {
        type: eventType,
        category: 'subscription',
        resourceType: 'subscription',
        resourceId: resourceId,
      },
      error: null,
      metadata: {
        received: {
          timestamp: nowTs,
          timestampUNIX: nowUNIX,
        },
        processed: {
          timestamp: null,
          timestampUNIX: null,
        },
      },
    });

    ctx.log(`Test uncancel provider: wrote payments-webhooks/${eventId} (${eventType}) for sub=${resourceId}, uid=${uid}`);
  },
};
