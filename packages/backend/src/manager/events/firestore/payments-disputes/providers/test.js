const powertools = require('node-powertools');

/**
 * Test dispute provider
 *
 * The dispute pipeline's counterpart to the payment test processors
 * (routes/payments/*\/providers/test.js): it implements the same two functions
 * the Stripe provider does, against the emulator's own records instead of a
 * payment processor's API.
 *
 * It exists because a dispute is the one payment path with no simulatable half.
 * `searchAndMatch` needs a real charge and `processDispute` needs a real refund
 * and a real cancel, so the whole chain — alert in, access revoked — could only
 * ever be proven against a live Stripe account, and the assertion that matters
 * most (a chargeback takes the subscription away) had no test at any tier
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * The simulation is deliberately shaped like the real thing:
 *   - the match is found by AMOUNT and CARD, the way Stripe's charge search is,
 *     so a mismatched alert reaches the no-match branch rather than being waved
 *     through on the email alone
 *   - the cancel is not written directly onto the user. It writes the same
 *     synthetic `customer.subscription.deleted` pipeline document the test
 *     refund processor writes, which is exactly what Stripe's
 *     `subscriptions.cancel()` produces: the webhook pipeline is what revokes
 *     access, here as in production
 *
 * NEVER available in production. The alert's `provider` comes off the alert
 * payload (Chargeblast's `processor` field), so an attacker who reached the
 * dispute door could otherwise name this provider and force-cancel a real
 * subscriber — the same reason the payment webhook route refuses `provider=test`
 * in production.
 */

// The card the simulation issues against. A dispute alert names the last four
// digits of the disputed card and nothing else identifies it, so the fixture
// personas all "pay" with this one.
const TEST_CARD_LAST4 = '4242';

module.exports = {
  /**
   * Find the subscriber this dispute alert is about
   *
   * Mirrors the Stripe provider's strategy against the emulator's records: the
   * alert names an amount and a card, and a match is a user whose live
   * subscription was bought at that amount on that card.
   *
   * @param {object} alert - Normalized alert data
   * @param {object} ctx - Assistant instance
   * @returns {Promise<object|null>} Match details or null
   */
  async searchAndMatch(alert, ctx) {
    refuseInProduction(ctx);

    const admin = ctx.Manager.libraries.admin;

    if (alert.card?.last4 !== TEST_CARD_LAST4) {
      ctx.log(`Test dispute provider: no charge on card ****${alert.card?.last4} — the simulation only issues ****${TEST_CARD_LAST4}`);
      return null;
    }

    // The alert carries no uid, exactly as a real one does not: Chargeblast knows
    // the customer's email and the card, never our identifiers.
    const email = alert.customerEmail;

    if (!email) {
      ctx.log(`Test dispute provider: alert ${alert.id} names no customer email — nothing to match against`);
      return null;
    }

    const snapshot = await admin.firestore()
      .collection('users')
      .where('auth.email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      ctx.log(`Test dispute provider: no user with email ${email}`);
      return null;
    }

    const uid = snapshot.docs[0].id;
    const subscription = snapshot.docs[0].data().subscription || {};
    const price = parseFloat(subscription.payment?.price || 0);

    // Amount is half the real provider's match, and the half that makes an
    // unrelated alert miss rather than land on whoever shares the card.
    if (Math.round(price * 100) !== Math.round(parseFloat(alert.amount) * 100)) {
      ctx.log(`Test dispute provider: ${email} paid $${price}, the alert names $${alert.amount} — no match`);
      return null;
    }

    const resourceId = subscription.payment?.resourceId || null;

    ctx.log(`Test dispute provider: matched uid=${uid}, subscription=${resourceId}, amount=$${price}, card=****${alert.card.last4}`);

    return {
      method: 'test-amount-and-card',
      chargeId: `_test-ch-dispute-${alert.id}`,
      invoiceId: null,
      subscriptionId: resourceId,
      customerId: `_test-cus-${uid}`,
      orderId: subscription.payment?.orderId || null,
      productId: subscription.product?.id || null,
      uid: uid,
      email: email,
    };
  },

  /**
   * Refund the charge and force-cancel the subscription
   *
   * The cancel is issued the way the real one is: by producing the provider
   * event a cancellation produces, and letting the webhook pipeline do the
   * revoking. Nothing here writes to the user document.
   *
   * @param {object} match - Match details from searchAndMatch
   * @param {object} alert - Normalized alert data
   * @param {object} ctx - Assistant instance
   * @returns {Promise<object>} Result with statuses
   */
  async processDispute(match, alert, ctx) {
    refuseInProduction(ctx);

    const admin = ctx.Manager.libraries.admin;

    const result = {
      refundId: `_test-re-dispute-${alert.id}`,
      amountRefunded: Math.round(parseFloat(alert.amount) * 100),
      currency: 'usd',
      refundStatus: 'success',
      cancelStatus: 'skipped',
      errors: [],
    };

    if (!match.subscriptionId) {
      ctx.log(`Test dispute provider: match has no subscription to cancel (uid=${match.uid})`);
      return result;
    }

    const timestamp = Date.now();
    const now = Math.floor(timestamp / 1000);
    const eventId = `_test-evt-dispute-cancel-${timestamp}`;
    const nowTs = powertools.timestamp(new Date(), { output: 'string' });
    const nowUNIX = powertools.timestamp(nowTs, { output: 'unix' });

    // The plan the pipeline resolves the product back out of. Without it the
    // cancelled subscription writes a null product, which is not what a real
    // `customer.subscription.deleted` carries — Stripe names the plan on the way
    // out. Falls back to the `_test_<id>` sentinel, like the payment processors.
    const products = ctx.Manager.config.payment?.products || [];
    const product = products.find((p) => p.id === match.productId);
    const stripeProductId = product
      ? (product.stripe?.productId || `_test_${product.id}`)
      : null;

    // Stripe's own shape for a cancelled subscription — what
    // `stripe.subscriptions.cancel()` sends back as a webhook.
    const subscriptionObj = {
      id: match.subscriptionId,
      object: 'subscription',
      status: 'canceled',
      metadata: { uid: match.uid, orderId: match.orderId || null },
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

    await admin.firestore().doc(`payments-webhooks/${eventId}`).set({
      id: eventId,
      provider: 'test',
      status: 'pending',
      owner: match.uid,
      raw: {
        id: eventId,
        type: 'customer.subscription.deleted',
        data: { object: subscriptionObj },
      },
      event: {
        type: 'customer.subscription.deleted',
        category: 'subscription',
        resourceType: 'subscription',
        resourceId: match.subscriptionId,
      },
      error: null,
      // The same keys the webhook route writes — `metadata.created.timestampUNIX`
      // is the pipeline's staleness clock.
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

    result.cancelStatus = 'success';

    ctx.log(`Test dispute provider: wrote payments-webhooks/${eventId} (customer.subscription.deleted) for sub=${match.subscriptionId}, uid=${match.uid}`);

    return result;
  },

  // The one card the simulation issues against, so a suite need not repeat it
  TEST_CARD_LAST4,
};

/**
 * Refuse to run outside a non-production environment
 *
 * The alert payload names the provider, so this guard is the boundary: without
 * it a forged alert could force-cancel a real subscriber by asking for the
 * simulation.
 *
 * @param {object} ctx - Assistant instance
 * @throws {Error} When the process is production
 */
function refuseInProduction(ctx) {
  if (ctx.isProduction()) {
    throw new Error('Test dispute provider is not available in production');
  }
}
