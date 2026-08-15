const powertools = require('node-powertools');

/**
 * Test plan-switch processor
 * Simulates the Stripe webhook that results from a plan change by writing
 * directly to payments-webhooks/{eventId} with status=pending. The on-write
 * trigger picks it up and runs the full pipeline.
 *
 * The event is customer.subscription.updated carrying the NEW product and the NEW
 * billing interval, so the existing plan-changed transition fires naturally — the
 * route needs no pipeline work of its own.
 *
 * Only available in non-production environments.
 */
module.exports = {
  async switchPlan({ resourceId, uid, subscription, product, frequency, ctx }) {
    if (ctx.isProduction()) {
      throw new Error('Test processor is not available in production');
    }

    const admin = ctx.Manager.libraries.admin;

    const timestamp = Date.now();
    const now = Math.floor(timestamp / 1000);
    const periodEnd = now + (30 * 86400);

    // The TARGET product's Stripe ID — this is what makes the pipeline resolve the
    // new plan. Falls back to the "_test_<id>" sentinel when no real Stripe
    // product is configured.
    const stripeProductId = product.stripe?.productId || `_test_${product.id}`;

    const FREQUENCY_TO_INTERVAL = { annually: 'year', monthly: 'month', weekly: 'week', daily: 'day' };
    const interval = FREQUENCY_TO_INTERVAL[frequency] || 'month';

    const eventType = 'customer.subscription.updated';
    const eventId = `_test-evt-plan-${timestamp}`;

    const subscriptionObj = {
      id: resourceId,
      object: 'subscription',
      status: 'active',
      metadata: { uid, orderId: subscription?.payment?.orderId || null },
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      current_period_end: periodEnd,
      current_period_start: now,
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
      processor: 'test',
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

    ctx.log(`Test plan processor: wrote payments-webhooks/${eventId} (${eventType}) for sub=${resourceId}, uid=${uid}, product=${product.id}, frequency=${frequency}`);
  },
};
