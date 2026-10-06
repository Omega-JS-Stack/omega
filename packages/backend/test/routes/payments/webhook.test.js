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
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/payments/webhook', {});

        expect(response, 'Should reject missing provider').toBeError(400);
      },
    },

    {
      name: 'rejects-invalid-key',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post('omega/payments/webhook?provider=stripe&key=wrong-key', {});

        expect(response, 'Should reject invalid key').toBeError(401);
      },
    },

    {
      name: 'rejects-unknown-provider',
      auth: 'none',
      async run({ http, expect }) {
        const response = await http.as('none').post(`omega/payments/webhook?provider=unknown&key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: 'evt_test_unknown',
          type: 'test.event',
          data: { object: {} },
        });

        expect(response, 'Should reject unknown provider').toBeError(400);
      },
    },

    {
      name: 'accepts-valid-stripe-webhook',
      auth: 'none',
      async run({ http, expect, firestore }) {
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
          `omega/payments/webhook?provider=stripe&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          payload,
        );

        expect(response, 'Should accept valid webhook').toBeSuccess();
        expect(response.data.received, 'Should confirm receipt').toBe(true);

        // Verify doc was saved to Firestore
        const doc = await firestore.get(`payments-webhooks/${eventId}`);
        expect(doc, 'Webhook doc should exist in Firestore').toBeTruthy();
        expect(doc.provider, 'Provider should be stripe').toBe('stripe');
        expect(doc.status === 'pending' || doc.status === 'processing' || doc.status === 'completed' || doc.status === 'failed', 'Status should be pending, processing, completed, or failed').toBeTruthy();
      },
    },

    {
      name: 'deduplicates-webhook-events',
      auth: 'none',
      async run({ http, expect, firestore }) {
        const eventId = '_test-evt-duplicate';

        // Use the test provider so the on-write trigger doesn't require STRIPE_SECRET_KEY
        // (a failed first webhook would let the dedup-retry branch fire instead of returning duplicate=true)
        const send = () => http.as('none').post(`omega/payments/webhook?provider=test&key=${process.env.OMEGA_WEBHOOK_KEY}`, {
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

        expect(response, 'Duplicate should still return 200').toBeSuccess();
        expect(response.data.duplicate, 'Should indicate duplicate').toBe(true);
      },
    },
  ],
});
