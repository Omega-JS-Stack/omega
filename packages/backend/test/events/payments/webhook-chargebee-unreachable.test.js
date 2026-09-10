/**
 * Test: a Chargebee webhook the Chargebee API cannot answer writes NOTHING
 *
 * The trigger used to degrade to the payload the webhook carried (flagged stale)
 * whenever the provider lookup failed, and wrote real subscription state from it —
 * an object supplied by whoever posted the event
 * ([#506](https://github.com/Omega-JS-Stack/omega/issues/506)). An unreachable
 * provider is not a provider saying anything at all, so the event now DEFERS: the
 * doc is marked failed, the retry sweep re-pends it, and no user doc, order or
 * intent is written off the payload in the meantime.
 *
 * Chargebee is unconfigured in this brand (no CHARGEBEE_API_KEY), so the lookup
 * fails for real, locally, with no network call and no credential.
 */

// The suite's own seeded persona ([#406](https://github.com/Omega-JS-Stack/omega/issues/406)):
// exclusive to this suite, declared in the seed roster, and the half the seed
// owns here is the AUTH USER — the doc is deleted below on purpose, and proving
// nothing recreates it is the point.

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const PERSONA = 'webhook-chargebee-unreachable';
const ORDER_ID = '6161-6161-6161';

module.exports = defineCases({
  description: 'A Chargebee lookup that cannot be answered defers instead of processing the payload',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'send-chargebee-subscription-webhook',
      async run({ accounts, http, firestore, assert, state, config }) {
        state.uid = accounts[PERSONA].uid;

        // Deleted so the run starts from nothing: anything found afterwards was
        // written by this event, off a payload nothing verified
        await firestore.delete(`users/${state.uid}`);
        await firestore.delete(`payments-orders/${ORDER_ID}`);

        state.orderId = ORDER_ID;
        state.resourceId = `_test-cb-unreachable-sub-${Date.now()}`;
        state.eventId = `_test-evt-cb-unreachable-${Date.now()}`;
        state.termEnd = Math.floor(Date.now() / 1000) + 86400 * 30;

        const response = await http.as('none').post(`backend-manager/payments/webhook?provider=chargebee&key=${config.webhookKey}`, {
          id: state.eventId,
          occurred_at: Math.floor(Date.now() / 1000),
          event_type: 'subscription_created',
          content: {
            subscription: {
              id: state.resourceId,
              customer_id: '_test-cb-unreachable-cust',
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
              id: '_test-cb-unreachable-cust',
              email: '_test.cb-unreachable@example.com',
              object: 'customer',
            },
          },
        });

        // The ROUTE still accepts it — storing the event is what makes the retry
        // ladder possible at all. The processing is what refuses to guess.
        assert.isSuccess(response, 'Webhook should be accepted');
      },
    },

    {
      name: 'the-event-defers-and-nothing-is-written-from-its-payload',
      async run({ firestore, assert, waitFor, state }) {
        // 45s, not the usual 15s: this is the first suite of the run and the emulator
        // is still draining the seeding wipe, which stretches the read back out
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'completed' || doc?.status === 'failed';
        }, 45000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);

        assert.equal(webhookDoc.status, 'failed', 'An unreachable Chargebee defers — the retry sweep is the reconciliation path');
        assert.equal(webhookDoc.retryCount, 1, 'The attempt is counted toward the retry ladder');
        assert.ok(!webhookDoc.refusal, 'A deferral is not a refusal — nothing was decided about this event');

        // The payload carried a complete active subscription. Anything below that
        // exists could only have come from it.
        const userDoc = await firestore.get(`users/${state.uid}`);

        assert.ok(!userDoc?.subscription, 'No subscription state is written from a payload the provider never confirmed');

        const orderDoc = await firestore.get(`payments-orders/${ORDER_ID}`);

        assert.ok(!orderDoc, 'And no order is minted behind it');
      },
    },
  ],
});
