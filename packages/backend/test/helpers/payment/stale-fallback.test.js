/**
 * Test: provider fetchResource() stale fallback
 *
 * Every provider library prefers the API's answer and falls back to the payload
 * the webhook carried when that call fails. The fallback used to be indistinguishable
 * from a fresh fetch — the API error was swallowed whole and the caller logged the
 * stale payload as "Fetched resource".
 *
 * These call each library's real fetchResource() with a resource type it does not
 * know: the throw happens inside the same try/catch a failed API call lands in, so
 * the fallback path runs for real without a network call or a live credential.
 */
const Stripe = require('../../../src/manager/libraries/payment/providers/stripe.js');
const PayPal = require('../../../src/manager/libraries/payment/providers/paypal.js');
const Chargebee = require('../../../src/manager/libraries/payment/providers/chargebee.js');

// The payload a webhook carried — what a failed fetch falls back to
function webhookPayload() {
  return { id: '_test-res-stale', object: 'subscription', status: 'active', metadata: { uid: '_test-uid', orderId: '1111-2222-3333' } };
}

module.exports = {
  description: 'Provider fetchResource() stale fallback flagging',
  type: 'group',

  tests: [
    {
      name: 'chargebee-flags-the-fallback',
      async run({ assert }) {
        const payload = webhookPayload();
        const resource = await Chargebee.fetchResource('unknown-type', '_test-res-stale', payload, {});

        assert.equal(resource._stale, true, 'A fallback resource should be flagged stale');
        assert.equal(resource.id, payload.id, 'The webhook payload should still come through');
        assert.equal(payload._stale, undefined, 'The webhook payload itself must not be branded in place');
      },
    },

    {
      name: 'paypal-flags-the-fallback',
      async run({ assert }) {
        const resource = await PayPal.fetchResource('unknown-type', '_test-res-stale', webhookPayload(), {});

        assert.equal(resource._stale, true, 'A fallback resource should be flagged stale');
        assert.equal(resource.metadata.uid, '_test-uid', 'The webhook payload should still come through');
      },
    },

    {
      name: 'stripe-flags-the-fallback',
      async run({ assert }) {
        // Stripe's SDK is constructed before the try/catch by design (a missing key is
        // a deployment fault, not a stale-data one), so the fallback path needs A key
        // present — never a live call: the unknown resource type throws first.
        const hadKey = process.env.STRIPE_SECRET_KEY;
        process.env.STRIPE_SECRET_KEY = hadKey || 'sk_test_stale_fallback';

        try {
          const resource = await Stripe.fetchResource('unknown-type', '_test-res-stale', webhookPayload(), {});

          assert.equal(resource._stale, true, 'A fallback resource should be flagged stale');
          assert.equal(resource.status, 'active', 'The webhook payload should still come through');
        } finally {
          if (!hadKey) {
            delete process.env.STRIPE_SECRET_KEY;
          }
        }
      },
    },

    {
      name: 'no-fallback-payload-still-throws',
      async run({ assert }) {
        // An empty payload is nothing to fall back TO — the failure must stay loud
        let threw = null;

        try {
          await Chargebee.fetchResource('unknown-type', '_test-res-stale', {}, {});
        } catch (e) {
          threw = e;
        }

        assert.ok(threw, 'A failed fetch with no payload to fall back to should throw');
        assert.match(threw.message, /unknown resource type/i, 'The original error should surface');
      },
    },
  ],
};
