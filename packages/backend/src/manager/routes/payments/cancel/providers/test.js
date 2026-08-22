const powertools = require('node-powertools');
const isTrialing = require('../_is-trialing.js');

/**
 * Test cancel provider
 * Simulates the Stripe webhook that results from cancellation
 * by writing directly to payments-webhooks/{eventId} with status=pending.
 * The on-write trigger picks it up and runs the full pipeline.
 *
 * If the user is trialing, simulates immediate cancellation (customer.subscription.deleted).
 * Otherwise, simulates cancel at period end (customer.subscription.updated with cancel_at_period_end=true).
 *
 * Only available in non-production environments.
 */
module.exports = {
  async cancelAtPeriodEnd({ resourceId, uid, subscription, ctx }) {
    if (ctx.isProduction()) {
      throw new Error('Test provider is not available in production');
    }

    const admin = ctx.Manager.libraries.admin;

    const timestamp = Date.now();
    const now = Math.floor(timestamp / 1000);
    const periodEnd = now + (30 * 86400);

    // Look up the Stripe product ID for the plan so resolveProduct() can match.
    // The order doc is the first source; when there is no order (a seeded paid persona, or
    // any state where the order is missing) the subscription's own product is the fallback —
    // without it the plan carries product=null and the pipeline downgrades the user to Basic
    // mid-cancel instead of scheduling the cancellation.
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

    // Detect if user is on a trial
    const trialing = isTrialing(subscription);

    // Trialing: immediate cancel (customer.subscription.deleted)
    // Non-trialing: cancel at period end (customer.subscription.updated)
    const eventType = trialing
      ? 'customer.subscription.deleted'
      : 'customer.subscription.updated';
    const eventId = `_test-evt-cancel-${timestamp}`;

    const subscriptionObj = {
      id: resourceId,
      object: 'subscription',
      status: trialing ? 'canceled' : 'active',
      // A seeded persona may have no order; Firestore rejects undefined outright.
      metadata: { uid, orderId: orderId || null },
      cancel_at_period_end: !trialing,
      cancel_at: trialing ? now : periodEnd,
      canceled_at: trialing ? now : null,
      current_period_end: trialing ? now : periodEnd,
      current_period_start: now - (30 * 86400),
      start_date: now - (30 * 86400),
      trial_start: trialing ? (now - 86400) : null,
      trial_end: trialing ? now : null,
      plan: { product: stripeProductId, interval: 'month' },
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

    ctx.log(`Test cancel provider: wrote payments-webhooks/${eventId} (${eventType}) for sub=${resourceId}, uid=${uid}, trialing=${trialing}`);
  },
};
