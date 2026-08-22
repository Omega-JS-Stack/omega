/**
 * Test: a failed webhook closes out its checkout intent
 *
 * The webhook trigger resolves the orderId partway through processing, so anything
 * that throws before that point (an unresolvable UID, a fetchResource failure) used
 * to leave payments-intents/{orderId} at 'pending' forever — a checkout the user
 * started that nothing ever closes.
 *
 * The failure path now resolves the orderId from what IS available (the webhook
 * payload the provider library can read one out of) and fails the intent with it.
 */
const powertools = require('node-powertools');

const ORDER_ID = '9119-9119-9119';

module.exports = {
  description: 'Webhook failure closes out its payments-intent',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'seed-pending-intent',
      async run({ firestore, assert, state }) {
        const now = powertools.timestamp(new Date(), { output: 'string' });

        state.orderId = ORDER_ID;
        state.resourceId = `_test-sub-no-uid-${Date.now()}`;
        state.eventId = `_test-evt-no-uid-${Date.now()}`;

        await firestore.set(`payments-intents/${ORDER_ID}`, {
          id: ORDER_ID,
          status: 'pending',
          provider: 'test',
          metadata: {
            created: {
              timestamp: now,
              timestampUNIX: powertools.timestamp(now, { output: 'unix' }),
            },
          },
        });

        const intentDoc = await firestore.get(`payments-intents/${ORDER_ID}`);
        assert.equal(intentDoc.status, 'pending', 'Intent should start pending');
      },
    },

    {
      name: 'send-webhook-with-no-uid',
      async run({ http, assert, state, config }) {
        // Carries the orderId but no uid, and names a subscription no order was ever
        // written for — so nothing can reconstruct the uid and processing throws
        const response = await http.as('none').post(`backend-manager/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.eventId,
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: state.resourceId,
              object: 'subscription',
              status: 'active',
              metadata: { orderId: state.orderId },
              cancel_at_period_end: false,
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
              current_period_start: Math.floor(Date.now() / 1000),
              start_date: Math.floor(Date.now() / 1000),
            },
          },
        });

        assert.isSuccess(response, 'Webhook should be accepted (it fails during processing, not at the door)');
      },
    },

    {
      name: 'webhook-fails-and-intent-is-failed',
      async run({ firestore, assert, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'failed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);
        assert.match(webhookDoc.error, /no UID/i, 'The webhook should have failed on the unresolvable UID');

        // The point: the intent no longer hangs pending behind that failure
        const intentDoc = await firestore.get(`payments-intents/${state.orderId}`);
        assert.equal(intentDoc.status, 'failed', 'The intent should be marked failed, not left pending');
        assert.ok(intentDoc.error, 'The intent should carry the failure reason');
      },
    },
  ],
};
