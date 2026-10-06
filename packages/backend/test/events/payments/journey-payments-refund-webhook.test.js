/**
 * Test: Payment Journey - Refund Webhook
 * Simulates: basic → paid active → pending cancel → charge.refunded webhook → payment-refunded transition
 *
 * Verifies that refund webhook events:
 * 1. Flow through the pipeline correctly
 * 2. Trigger the payment-refunded transition (not subscription-cancelled)
 * 3. Extract refundDetails via the provider library's getRefundDetails()
 * 4. Record the transition name on the webhook doc for auditing
 *
 * 5. Fire exactly once when the same refund event is reprocessed
 *
 * Product-agnostic: resolves the first paid product from config.payment.products
 */
const powertools = require('node-powertools');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Payment journey: paid → refund webhook → payment-refunded transition',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'setup-paid-subscription',
      async run({ accounts, firestore, expect, state, config, http, waitFor, skip, payments }) {
        const uid = accounts['journey-payments-refund-webhook'].uid;

        // Resolve a paid product with a monthly price. If the brand has none configured,
        // skip the entire journey — this is a config-gap, not a code failure.
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices?.monthly);
        if (!paidProduct) {
          skip('No paid product with monthly price configured in this brand');
        }

        state.uid = uid;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];
        // Create subscription via test intent
        const response = await http.as('journey-payments-refund-webhook').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: state.product.frequency,
        });
        expect(response, 'Intent should succeed').toBeSuccess();
        state.orderId = response.data.orderId;

        // Wait for subscription to activate
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.product?.id === paidProduct.id
            && userDoc?.subscription?.status === 'active';
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc.subscription?.product?.id, `Should be ${paidProduct.id}`).toBe(paidProduct.id);
        expect(userDoc.subscription?.status, 'Should be active').toBe('active');

        state.subscriptionId = userDoc.subscription.payment.resourceId;
      },
    },

    {
      name: 'send-pending-cancel-webhook',
      async run({ http, expect, state, config, payments }) {
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + 1);

        state.cancelEventId = `_test-evt-journey-refund-cancel-${Date.now()}`;

        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.cancelEventId,
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: state.subscriptionId,
              object: 'subscription',
              status: 'active',
              metadata: { uid: state.uid, orderId: state.orderId },
              cancel_at_period_end: true,
              cancel_at: Math.floor(futureDate.getTime() / 1000),
              canceled_at: null,
              current_period_end: Math.floor(futureDate.getTime() / 1000),
              current_period_start: Math.floor(Date.now() / 1000),
              start_date: Math.floor(Date.now() / 1000) - 86400 * 30,
              trial_start: null,
              trial_end: null,
              plan: { product: payments.stripeProductIds[state.paidProductId], interval: state.product.interval },
            },
          },
        });

        expect(response, 'Cancel webhook should be accepted').toBeSuccess();
      },
    },

    {
      name: 'cancellation-pending-confirmed',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.cancelEventId}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.cancelEventId}`);
        expect(webhookDoc.transition, 'Should detect cancellation-requested').toBe('cancellation-requested');

        const userDoc = await firestore.get(`users/${state.uid}`);
        expect(userDoc.subscription.status, 'Status should still be active').toBe('active');
        expect(userDoc.subscription.cancellation.pending, 'Cancellation should be pending').toBe(true);
      },
    },

    {
      name: 'send-charge-refunded-webhook',
      async run({ http, expect, state, config }) {
        // Simulate a charge.refunded event (Stripe-shaped, used by test provider)
        // This carries refund amount data that getRefundDetails() extracts
        state.refundEventId = `_test-evt-journey-refund-charge-${Date.now()}`;
        state.refundAmountCents = 2800; // $28.00

        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.refundEventId,
          type: 'charge.refunded',
          data: {
            object: {
              id: `ch_test_${Date.now()}`,
              object: 'charge',
              amount: state.refundAmountCents,
              amount_refunded: state.refundAmountCents,
              currency: 'usd',
              subscription: state.subscriptionId,
              metadata: { uid: state.uid, orderId: state.orderId },
              refunds: {
                data: [
                  {
                    id: `re_test_${Date.now()}`,
                    amount: state.refundAmountCents,
                    currency: 'usd',
                    reason: 'requested_by_customer',
                  },
                ],
              },
            },
          },
        });

        expect(response, 'Refund webhook should be accepted').toBeSuccess();
      },
    },

    {
      name: 'payment-refunded-transition-detected',
      async run({ firestore, expect, state, waitFor }) {
        // Wait for the refund webhook to be processed
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.refundEventId}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.refundEventId}`);

        // Core assertion: refund events trigger payment-refunded, not subscription-cancelled
        expect(webhookDoc.status, 'Webhook should complete successfully').toBe('completed');
        expect(webhookDoc.transition, 'Transition should be payment-refunded (not subscription-cancelled)').toBe('payment-refunded');
        expect(webhookDoc.owner, 'Owner should match').toBe(state.uid);
        expect(webhookDoc.orderId, 'Order ID should match').toBe(state.orderId);
      },
    },

    {
      name: 'order-doc-updated',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.type, 'Type should be subscription').toBe('subscription');
        expect(orderDoc.owner, 'Owner should match').toBe(state.uid);

        // The order was last updated by the refund webhook event
        expect(orderDoc.metadata?.updatedBy?.event?.name, 'Last event should be charge.refunded').toBe('charge.refunded');
      },
    },

    {
      name: 'reprocessed-refund-fires-once',
      async run({ firestore, expect, state, waitFor }) {
        // Reprocess the SAME refund event: put the completed doc back to pending,
        // exactly as the route's retry path does. Refund detection reads the event
        // type alone, so without an idempotency guard the second pass re-dispatches
        // payment-refunded and the customer is emailed twice about one refund.
        //
        // The received timestamp is deliberately set AHEAD of the order's last write
        // so the pre-existing staleness guard cannot be what skips this pass — the
        // only thing left to suppress the transition is the idempotency guard.
        const received = powertools.timestamp(new Date(Date.now() + 60000), { output: 'string' });

        await firestore.set(`payments-webhooks/${state.refundEventId}`, {
          status: 'pending',
          transition: 'reprocessing',
          metadata: {
            created: {
              timestamp: received,
              timestampUNIX: powertools.timestamp(received, { output: 'unix' }),
            },
          },
        }, { merge: true });

        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.refundEventId}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.refundEventId}`);

        expect(webhookDoc.transition, 'A reprocessed refund must dispatch nothing — one refund, one email').toBe(null);
        expect(webhookDoc.orderId, 'The reprocess should still resolve the same order').toBe(state.orderId);

        // The pass ran in full (it was not skipped as stale) — the order carries its write
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);
        expect(orderDoc.metadata?.updatedBy?.event?.id, 'The order should record the reprocessed event').toBe(state.refundEventId);
      },
    },
  ],
});
