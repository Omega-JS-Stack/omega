const powertools = require('node-powertools');

/**
 * Test refund provider
 * Simulates the webhook a real refund produces by writing directly to
 * payments-webhooks/{eventId} with status=pending. The on-write trigger picks it
 * up and runs the full pipeline.
 *
 * - Subscription: a Stripe-shaped customer.subscription.deleted (refund +
 *   immediate cancellation), resulting in a subscription-cancelled transition.
 * - One-time: a Stripe-shaped charge.refunded carrying no subscription and no
 *   invoice, resulting in a purchase-refunded transition.
 *
 * Only available in non-production environments.
 */
module.exports = {
  async processRefund({ resourceId, uid, subscription, ctx }) {
    if (ctx.isProduction()) {
      throw new Error('Test provider is not available in production');
    }

    const admin = ctx.Manager.libraries.admin;

    const timestamp = Date.now();
    const eventId = `_test-evt-refund-${timestamp}`;
    const now = Math.floor(timestamp / 1000);

    // Look up the Stripe product ID for the plan so resolveProduct() can match.
    // The order doc is the first source; when there is no order (a seeded paid persona, or
    // any state where the order is missing) the subscription's own product is the fallback —
    // without it the plan carries product=null and the pipeline downgrades the user to Basic
    // mid-refund instead of recording the cancelled paid subscription
    // ([#216](https://github.com/Omega-JS-Stack/omega/issues/216), the #210 fix on this path).
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

    // Build a Stripe-shaped customer.subscription.deleted payload
    // Mirrors what Stripe sends after an immediate cancellation (refund + cancel)
    const subscriptionObj = {
      id: resourceId,
      object: 'subscription',
      status: 'canceled',
      metadata: { uid, orderId },
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: now,
      current_period_end: now,
      current_period_start: now - (30 * 86400),
      start_date: now - (30 * 86400),
      trial_start: null,
      trial_end: null,
      plan: { product: stripeProductId, interval: 'month' },
    };

    // Write directly to payments-webhooks — on-write trigger handles the rest
    await writeWebhook({
      admin,
      eventId,
      uid,
      eventType: 'customer.subscription.deleted',
      dataObject: subscriptionObj,
      event: {
        category: 'subscription',
        resourceType: 'subscription',
        resourceId: resourceId,
      },
    });

    ctx.log(`Test refund provider: wrote payments-webhooks/${eventId} for sub=${resourceId}, uid=${uid}`);

    // Return mock refund result
    return {
      amount: subscription?.payment?.price || 0,
      currency: 'usd',
      full: true,
    };
  },

  async processOneTimeRefund({ resourceId, uid, order, ctx }) {
    if (ctx.isProduction()) {
      throw new Error('Test provider is not available in production');
    }

    const admin = ctx.Manager.libraries.admin;

    const timestamp = Date.now();
    const eventId = `_test-evt-refund-one-time-${timestamp}`;
    const amount = order?.unified?.payment?.price || 0;
    const amountCents = Math.round(amount * 100);

    // Build a Stripe-shaped charge.refunded payload. It carries no subscription
    // and no invoice — the shape a refunded one-time purchase produces, and what
    // the webhook parser categorizes as one-time. Its metadata is the metadata a
    // real charge inherits from the PaymentIntent the checkout created: uid and
    // orderId ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
    const chargeObj = {
      id: `_test-ch-${timestamp}`,
      object: 'charge',
      status: 'succeeded',
      amount: amountCents,
      amount_refunded: amountCents,
      currency: 'usd',
      invoice: null,
      subscription: null,
      metadata: { uid, orderId: order?.id || null },
      refunds: {
        data: [
          {
            id: `_test-re-${timestamp}`,
            amount: amountCents,
            currency: 'usd',
            reason: 'requested_by_customer',
          },
        ],
      },
    };

    await writeWebhook({
      admin,
      eventId,
      uid,
      eventType: 'charge.refunded',
      dataObject: chargeObj,
      event: {
        category: 'one-time',
        resourceType: 'charge',
        resourceId: chargeObj.id,
      },
    });

    ctx.log(`Test refund provider: wrote payments-webhooks/${eventId} for one-time order=${order?.id}, session=${resourceId}, uid=${uid}`);

    // Return mock refund result — a one-time purchase always refunds in full
    return {
      amount: amount,
      currency: 'usd',
      full: true,
    };
  },
};

/**
 * Write the synthetic pipeline doc both refund paths produce
 *
 * @param {object} options
 * @param {object} options.admin - Firebase admin instance
 * @param {string} options.eventId - The payments-webhooks doc id
 * @param {string} options.uid - Owner UID
 * @param {string} options.eventType - The Stripe-shaped event type
 * @param {object} options.dataObject - The Stripe-shaped resource the event carries
 * @param {object} options.event - The rest of the parsed event block (category, resourceType, resourceId)
 */
async function writeWebhook({ admin, eventId, uid, eventType, dataObject, event }) {
  const nowTs = powertools.timestamp(new Date(), { output: 'string' });
  const nowUNIX = powertools.timestamp(nowTs, { output: 'unix' });

  await admin.firestore().doc(`payments-webhooks/${eventId}`).set({
    id: eventId,
    provider: 'test',
    status: 'pending',
    owner: uid,
    raw: {
      id: eventId,
      type: eventType,
      data: { object: dataObject },
    },
    event: {
      type: eventType,
      ...event,
    },
    error: null,
    // The SAME keys the webhook route writes ([../../webhook/post.js]) — the
    // pipeline's staleness clock reads `metadata.created.timestampUNIX`, so a
    // synthetic doc spelling it `received` handed the clock nothing and rode a
    // now-fallback that made every test-processor event look freshly arrived
    // ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
    metadata: {
      created: {
        timestamp: nowTs,
        timestampUNIX: nowUNIX,
      },
      completed: {
        timestamp: null,
        timestampUNIX: null,
      },
    },
  });
}
