/**
 * Test: a Chargebee webhook survives an unreachable Chargebee API
 *
 * The trigger prefers the provider API's answer over the payload the webhook
 * carried, and falls back to that payload (flagged stale) when the call fails. It
 * read the fallback out of Stripe's envelope for every provider, so a Chargebee
 * event — whose resource lives at `content.<type>` — fell back to nothing and the
 * failed fetch threw instead ([#222]). A brand on Chargebee lost the whole event
 * every time Chargebee was unreachable.
 *
 * Chargebee is unconfigured in this brand (no CHARGEBEE_API_KEY), so the fetch fails
 * for real, locally, with no network call and no credential.
 */

// The suite's own seeded persona ([#406](https://github.com/Omega-JS-Stack/omega/issues/406)):
// exclusive to this suite, declared in the seed roster, and the half the seed
// owns here is the AUTH USER — the doc is deleted below on purpose.
const PERSONA = 'webhook-chargebee-stale-fallback';
const ORDER_ID = '6161-6161-6161';

module.exports = {
  description: 'A Chargebee re-fetch failure degrades to the webhook payload',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'send-chargebee-subscription-webhook',
      async run({ accounts, http, firestore, assert, state, config }) {
        state.uid = accounts[PERSONA].uid;

        // The pipeline writes this subscriber's doc from scratch, so the seeded
        // doc comes off first — the auth user behind it is what makes the write
        // legal at all ([#399])
        await firestore.delete(`users/${state.uid}`);
        await firestore.delete(`payments-orders/${ORDER_ID}`);

        state.orderId = ORDER_ID;
        state.resourceId = `_test-cb-stale-sub-${Date.now()}`;
        state.eventId = `_test-evt-cb-stale-${Date.now()}`;
        state.termEnd = Math.floor(Date.now() / 1000) + 86400 * 30;

        const response = await http.as('none').post(`backend-manager/payments/webhook?provider=chargebee&key=${config.webhookKey}`, {
          id: state.eventId,
          occurred_at: Math.floor(Date.now() / 1000),
          event_type: 'subscription_created',
          content: {
            subscription: {
              id: state.resourceId,
              customer_id: '_test-cb-stale-cust',
              status: 'active',
              current_term_start: Math.floor(Date.now() / 1000),
              current_term_end: state.termEnd,
              created_at: Math.floor(Date.now() / 1000),
              started_at: Math.floor(Date.now() / 1000),
              subscription_items: [{ item_price_id: 'premium-monthly', item_type: 'plan', quantity: 1 }],
              meta_data: JSON.stringify({ uid: state.uid, orderId: ORDER_ID }),
              currency_code: 'USD',
              object: 'subscription',
            },
            customer: {
              id: '_test-cb-stale-cust',
              email: '_test.cb-stale@example.com',
              object: 'customer',
            },
          },
        });

        assert.isSuccess(response, 'Webhook should be accepted');
      },
    },

    {
      name: 'the-webhook-completes-off-its-own-payload',
      async run({ firestore, assert, waitFor, state }) {
        // 45s, not the usual 15s: this is the first suite of the run and the emulator
        // is still draining the seeding wipe, which stretches the read back out
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'completed' || doc?.status === 'failed';
        }, 45000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);

        assert.equal(webhookDoc.status, 'completed', `An unreachable Chargebee must degrade, not fail (error: ${webhookDoc.error || 'none'})`);
        assert.equal(webhookDoc.orderId, ORDER_ID, 'The orderId came out of the payload the webhook carried');

        // The state is the payload's own — nothing else could have supplied it
        const userDoc = await firestore.get(`users/${state.uid}`);

        assert.equal(userDoc.subscription.status, 'active', 'The subscription was written from the stale payload');
        assert.equal(userDoc.subscription.payment.provider, 'chargebee', 'It is a Chargebee subscription');
        assert.equal(userDoc.subscription.payment.resourceId, state.resourceId, 'It names the subscription the webhook carried');
        assert.equal(userDoc.subscription.expires.timestampUNIX, state.termEnd, 'The expiry is the payload\'s current_term_end');

        const orderDoc = await firestore.get(`payments-orders/${ORDER_ID}`);

        assert.equal(orderDoc.provider, 'chargebee', 'The order was written for Chargebee');
        assert.equal(orderDoc.owner, state.uid, 'The order belongs to the payload\'s uid');
      },
    },
  ],
};
