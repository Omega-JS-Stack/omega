const powertools = require('node-powertools');

/**
 * Test plan-switch provider
 * Simulates the Stripe webhook that results from a plan change by writing
 * directly to payments-webhooks/{eventId} with status=pending. The on-write
 * trigger picks it up and runs the full pipeline.
 *
 * The event is customer.subscription.updated carrying the NEW product and the NEW
 * billing interval, so the existing plan-changed transition fires naturally — the
 * route needs no pipeline work of its own.
 *
 * It also carries the EXISTING trial forward, exactly as Stripe keeps trial_start
 * and trial_end on a subscription whose item was swapped. Fabricating them as null
 * is what ended a live trial on switch ([#237]) — the unified transform reads
 * `trial.claimed` straight off the event, and the user-doc write is a merge.
 *
 * Only available in non-production environments.
 */
module.exports = {
  async switchPlan({ resourceId, uid, subscription, product, frequency, ctx }) {
    if (ctx.isProduction()) {
      throw new Error('Test provider is not available in production');
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

    const startDate = subscription?.payment?.startDate?.timestampUNIX || (now - (30 * 86400));

    // The trial rides along untouched: a claimed trial keeps its ORIGINAL end
    // date on the new plan, and the subscription is still `trialing` while that
    // date is ahead of us — the same two facts Stripe reports after an item swap.
    const trialEnd = subscription?.trial?.claimed ? (subscription.trial.expires?.timestampUNIX || null) : null;
    const trialStart = trialEnd ? startDate : null;
    const trialing = !!trialEnd && trialEnd > now;

    const subscriptionObj = {
      id: resourceId,
      object: 'subscription',
      status: trialing ? 'trialing' : 'active',
      metadata: { uid, orderId: subscription?.payment?.orderId || null },
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      // While a subscription is trialing, Stripe's current period IS the trial
      // period — and the cancel providers read that equality (`trial.expires`
      // === `expires`) to decide a cancellation is immediate. Fabricating a
      // 30-day period under a live trial would break cancel-immediacy after a
      // switch and misreport the next billing date.
      current_period_end: trialing ? trialEnd : periodEnd,
      current_period_start: trialing ? trialStart : now,
      start_date: startDate,
      trial_start: trialStart,
      trial_end: trialEnd,
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

    ctx.log(`Test plan provider: wrote payments-webhooks/${eventId} (${eventType}) for sub=${resourceId}, uid=${uid}, product=${product.id}, frequency=${frequency}, trialEnd=${trialEnd}`);
  },
};
