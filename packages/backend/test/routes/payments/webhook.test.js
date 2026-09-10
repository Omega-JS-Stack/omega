/**
 * Test: POST /payments/webhook
 * Tests the webhook endpoint validates requests and saves to Firestore
 *
 * The Stripe round trips ride the real HTTP surface, so a delivery is gated by
 * the shared `?key=` param alone — the one check every provider rides.
 */
const { TEST_ACCOUNTS } = require('../../../dist/test/test-accounts.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Payment webhook endpoint',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'rejects-missing-provider',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').post('backend-manager/payments/webhook', {});

        assert.isError(response, 400, 'Should reject missing provider');
      },
    },

    {
      name: 'rejects-invalid-key',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').post('backend-manager/payments/webhook?provider=stripe&key=wrong-key', {});

        assert.isError(response, 401, 'Should reject invalid key');
      },
    },

    {
      name: 'rejects-unknown-provider',
      auth: 'none',
      async run({ http, assert }) {
        const response = await http.as('none').post(`backend-manager/payments/webhook?provider=unknown&key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: 'evt_test_unknown',
          type: 'test.event',
          data: { object: {} },
        });

        assert.isError(response, 400, 'Should reject unknown provider');
      },
    },

    {
      name: 'accepts-valid-stripe-webhook',
      auth: 'none',
      async run({ http, assert, firestore }) {
        const eventId = '_test-evt-valid-webhook';
        const payload = {
          id: eventId,
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_test_valid',
              metadata: { uid: TEST_ACCOUNTS.basic.uid },
              status: 'active',
            },
          },
        };

        const response = await http.as('none').post(
          `backend-manager/payments/webhook?provider=stripe&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          payload,
        );

        assert.isSuccess(response, 'Should accept valid webhook');
        assert.equal(response.data.received, true, 'Should confirm receipt');

        // Verify doc was saved to Firestore
        const doc = await firestore.get(`payments-webhooks/${eventId}`);
        assert.ok(doc, 'Webhook doc should exist in Firestore');
        assert.equal(doc.provider, 'stripe', 'Provider should be stripe');
        assert.ok(
          doc.status === 'pending' || doc.status === 'processing' || doc.status === 'completed' || doc.status === 'failed',
          'Status should be pending, processing, completed, or failed',
        );
      },
    },

    {
      name: 'deduplicates-webhook-events',
      auth: 'none',
      async run({ http, assert, firestore }) {
        const eventId = '_test-evt-duplicate';

        // Use the test provider so the on-write trigger doesn't require STRIPE_SECRET_KEY
        // (a failed first webhook would let the dedup-retry branch fire instead of returning duplicate=true)
        const send = () => http.as('none').post(`backend-manager/payments/webhook?provider=test&key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: eventId,
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: 'sub_test_dup',
              metadata: { uid: TEST_ACCOUNTS.basic.uid },
              status: 'active',
            },
          },
        });

        await send();
        const response = await send();

        assert.isSuccess(response, 'Duplicate should still return 200');
        assert.equal(response.data.duplicate, true, 'Should indicate duplicate');
      },
    },
  ],
});
