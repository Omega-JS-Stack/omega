/**
 * Test: Payment Journey - One-Time Payment Failure
 * Simulates: invoice.payment_failed for a non-subscription invoice → purchase-failed transition
 *
 * This verifies the webhook routing for one-time invoice failures:
 * invoice.payment_failed with no subscription billing_reason → category: 'one-time'
 *
 * Uses the journey-payments-one-time account (one-time events don't modify subscription state)
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: one-time invoice.payment_failed → purchase-failed',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'resolve-one-time-product',
      async run({ accounts, expect, state, config, skip }) {
        const uid = accounts['journey-payments-one-time'].uid;

        // Resolve first one-time product from config. If none configured, skip the
        // entire journey — this is a config-gap, not a code failure.
        const oneTimeProduct = config.payment.products.find(p => p.type === 'one-time' && p.prices?.once);
        if (!oneTimeProduct) {
          skip('No one-time product configured in this brand');
        }

        state.uid = uid;
        state.productId = oneTimeProduct.id;
      },
    },

    {
      name: 'send-one-time-payment-failed',
      async run({ http, expect, state, config }) {
        state.eventId = `_test-evt-journey-onetime-fail-${Date.now()}`;
        state.invoiceId = `_test-inv-onetime-fail-${Date.now()}`;
        state.orderId = `0000-0000-0000`; // Fake orderId for test

        // Send invoice.payment_failed with a non-subscription billing reason
        // This routes to category: 'one-time' in the webhook parser
        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.eventId,
          type: 'invoice.payment_failed',
          data: {
            object: {
              id: state.invoiceId,
              object: 'invoice',
              billing_reason: 'manual',
              amount_due: 999,
              amount_paid: 0,
              status: 'open',
              metadata: {
                uid: state.uid,
                orderId: state.orderId,
                productId: state.productId,
              },
            },
          },
        });

        expect(response, 'Webhook should be accepted').toBeSuccess();
      },
    },

    {
      name: 'webhook-categorized-as-one-time',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'completed' || doc?.status === 'failed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);
        expect(webhookDoc, 'Webhook doc should exist').toBeTruthy();
        expect(webhookDoc.event?.category, 'Category should be one-time').toBe('one-time');
        expect(webhookDoc.event?.resourceType, 'Resource type should be invoice').toBe('invoice');
        expect(webhookDoc.transition, 'Transition should be purchase-failed').toBe('purchase-failed');
      },
    },

    {
      name: 'order-doc-created-with-failure',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.type, 'Type should be one-time').toBe('one-time');
        expect(orderDoc.owner, 'Owner should match').toBe(state.uid);
        expect(orderDoc.provider, 'Provider should be test').toBe('test');
        expect(orderDoc.requests !== undefined, 'requests field should exist').toBeTruthy();
        expect(orderDoc.requests.cancellation, 'requests.cancellation should be null').toBe(null);
        expect(orderDoc.requests.refund, 'requests.refund should be null').toBe(null);
      },
    },

    {
      name: 'subscription-unchanged',
      async run({ firestore, expect, state }) {
        // One-time payment failures must NOT modify subscription state
        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription?.product?.id, 'Subscription should remain basic after one-time failure').toBe('basic');
      },
    },
  ],
});
