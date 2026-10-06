/**
 * Test: Payment Journey - Cancel
 * Simulates: paid active → pending cancel → cancelled
 *
 * Uses test intent for initial subscription, then manual webhooks for cancel flow
 * Product-agnostic: resolves the first paid product from config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: paid → pending cancel → cancelled',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'setup-paid-subscription',
      async run({ accounts, firestore, expect, state, config, http, waitFor, skip, payments }) {
        const uid = accounts['journey-payments-cancel'].uid;

        // Resolve first paid product from config. If the brand has none configured,
        // skip the entire journey — this is a config-gap, not a code failure.
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        state.uid = uid;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];

        state.paidProductName = paidProduct.name;

        // Create subscription via test intent
        const response = await http.as('journey-payments-cancel').post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: state.product.frequency,
        });
        expect(response, 'Intent should succeed').toBeSuccess();
        state.orderId = response.data.orderId;

        // Wait for subscription to activate
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.product?.id === paidProduct.id;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc.subscription?.product?.id, `Should start as ${paidProduct.id}`).toBe(paidProduct.id);
        expect(userDoc.subscription?.status, 'Should be active').toBe('active');
        expect(userDoc.subscription?.payment?.orderId, 'Order ID should match intent').toBe(state.orderId);

        state.subscriptionId = userDoc.subscription.payment.resourceId;
      },
    },

    {
      name: 'send-pending-cancel-webhook',
      async run({ http, expect, state, config, payments }) {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);

        state.eventId1 = `_test-evt-journey-cancel-pending-${Date.now()}`;

        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.eventId1,
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

        expect(response, 'Webhook should be accepted').toBeSuccess();
      },
    },

    {
      name: 'pending-cancel-processed',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId1}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId1}`);
        expect(webhookDoc.transition, 'Transition should be cancellation-requested').toBe('cancellation-requested');

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.status, 'Status should still be active').toBe('active');
        expect(userDoc.subscription.cancellation.pending, 'Cancellation should be pending').toBe(true);
      },
    },

    {
      name: 'send-cancelled-webhook',
      async run({ http, expect, state, config, payments }) {
        state.eventId2 = `_test-evt-journey-cancel-final-${Date.now()}`;

        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.eventId2,
          type: 'customer.subscription.deleted',
          data: {
            object: {
              id: state.subscriptionId,
              object: 'subscription',
              status: 'canceled',
              metadata: { uid: state.uid, orderId: state.orderId },
              cancel_at_period_end: false,
              canceled_at: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000),
              current_period_start: Math.floor(Date.now() / 1000) - 86400 * 30,
              start_date: Math.floor(Date.now() / 1000) - 86400 * 60,
              trial_start: null,
              trial_end: null,
              plan: { product: payments.stripeProductIds[state.paidProductId], interval: state.product.interval },
            },
          },
        });

        expect(response, 'Webhook should be accepted').toBeSuccess();
      },
    },

    {
      name: 'subscription-cancelled',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId2}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId2}`);
        expect(webhookDoc.transition, 'Transition should be subscription-cancelled').toBe('subscription-cancelled');

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.status, 'Status should be cancelled').toBe('cancelled');
        expect(userDoc.subscription.cancellation.pending, 'Cancellation should not be pending').toBe(false);
      },
    },

    {
      name: 'order-doc-verified',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.type, 'Type should be subscription').toBe('subscription');
        expect(orderDoc.owner, 'Owner should match').toBe(state.uid);
        expect(orderDoc.requests !== undefined, 'requests field should exist').toBeTruthy();
        expect(orderDoc.requests.cancellation, 'requests.cancellation should be null (cancel was via webhook, not endpoint)').toBe(null);
        expect(orderDoc.requests.refund, 'requests.refund should be null').toBe(null);
      },
    },

    {
      name: 'intent-doc-completed',
      async run({ firestore, expect, state }) {
        const intentDoc = await firestore.get(`payments-intents/${state.orderId}`);

        expect(intentDoc, 'Intent doc should exist').toBeTruthy();
        expect(intentDoc.id, 'ID should match orderId').toBe(state.orderId);
        expect(intentDoc.status, 'Intent status should be completed after webhook processing').toBe('completed');
        expect(intentDoc.metadata?.completed?.timestampUNIX > 0, 'Completed timestamp should be set').toBeTruthy();
      },
    },
  ],
});
