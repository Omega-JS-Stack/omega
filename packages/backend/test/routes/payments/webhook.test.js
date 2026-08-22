/**
 * Test: POST /payments/webhook
 * Tests the webhook endpoint validates requests and saves to Firestore
 *
 * The Stripe round trips ride the real HTTP surface, so they are also the proof
 * that the delivered bytes reach the route as `req.rawBody` — the only thing a
 * signature can be verified against. They sign whenever `STRIPE_WEBHOOK_SECRET`
 * is configured (the sandbox brand's .env carries one); a consumer without it
 * runs the route's key-only mode instead, and the strict cases skip. The gate's
 * own matrix lives in webhook-signature.test.js.
 */
const Stripe = require('stripe');
const { TEST_ACCOUNTS } = require('../../../src/test/test-accounts.js');

// The bytes the http client puts on the wire are JSON.stringify(payload) — the
// same bytes Firebase hands the route, and the ones this signature covers.
function stripeSignature(payload, secret) {
  return Stripe.webhooks.generateTestHeaderString({
    payload: JSON.stringify(payload),
    secret: secret,
  });
}

// Request options carrying a Stripe signature header, or none when the route is
// in key-only mode.
function signedOptions(payload, secret) {
  if (!secret) {
    return undefined;
  }

  return { headers: { 'stripe-signature': stripeSignature(payload, secret) } };
}

module.exports = {
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
          signedOptions(payload, process.env.STRIPE_WEBHOOK_SECRET),
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
      name: 'rejects-unsigned-stripe-webhook',
      auth: 'none',
      async run({ http, assert, skip }) {
        if (!process.env.STRIPE_WEBHOOK_SECRET) {
          return skip('STRIPE_WEBHOOK_SECRET is not configured — the route runs key-only here');
        }

        const response = await http.as('none').post(`backend-manager/payments/webhook?provider=stripe&key=${process.env.OMEGA_WEBHOOK_KEY}`, {
          id: '_test-evt-unsigned-webhook',
          type: 'customer.subscription.updated',
          data: { object: { id: 'sub_test_unsigned', metadata: { uid: TEST_ACCOUNTS.basic.uid }, status: 'active' } },
        });

        assert.isError(response, 401, 'Should reject an unsigned webhook while the secret is configured');
      },
    },

    {
      name: 'rejects-stripe-webhook-signed-for-other-bytes',
      auth: 'none',
      async run({ http, assert, firestore, skip }) {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!secret) {
          return skip('STRIPE_WEBHOOK_SECRET is not configured — the route runs key-only here');
        }

        const eventId = '_test-evt-forged-webhook';
        const signature = stripeSignature({ id: eventId, type: 'customer.subscription.updated', data: { object: { id: 'sub_test_signed' } } }, secret);

        // Same signature, different body — the forgery the shared key cannot catch.
        const response = await http.as('none').post(
          `backend-manager/payments/webhook?provider=stripe&key=${process.env.OMEGA_WEBHOOK_KEY}`,
          {
            id: eventId,
            type: 'customer.subscription.updated',
            data: { object: { id: 'sub_test_forged', metadata: { uid: TEST_ACCOUNTS.basic.uid }, status: 'active' } },
          },
          { headers: { 'stripe-signature': signature } },
        );

        assert.isError(response, 401, 'Should reject a payload the signature does not cover');

        const doc = await firestore.get(`payments-webhooks/${eventId}`);
        assert.equal(doc, null, 'A rejected webhook must never reach Firestore');
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
};
