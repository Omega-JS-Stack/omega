/**
 * Test: Payment Journey - Suspend & Recover
 * Simulates: paid active → payment fails → suspended → payment succeeds → active again
 *
 * Uses test intent for initial subscription, then manual webhooks for suspend/recover
 * Product-agnostic: resolves the first paid product from config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: paid → suspended → recovered via test provider',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'setup-paid-subscription',
      async run({ accounts, firestore, expect, state, config, http, waitFor, skip, payments }) {
        const uid = accounts['journey-payments-suspend'].uid;

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
        const response = await http.as('journey-payments-suspend').post('omega/payments/intent', {
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
      name: 'send-past-due-webhook',
      async run({ http, expect, state, config, payments }) {
        state.eventId1 = `_test-evt-journey-suspend-fail-${Date.now()}`;

        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.eventId1,
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: state.subscriptionId,
              object: 'subscription',
              status: 'past_due',
              metadata: { uid: state.uid, orderId: state.orderId },
              cancel_at_period_end: false,
              canceled_at: null,
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
              current_period_start: Math.floor(Date.now() / 1000) - 86400 * 29,
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
      name: 'subscription-suspended',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId1}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId1}`);
        expect(webhookDoc.transition, 'Transition should be payment-failed').toBe('payment-failed');

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.status, 'Status should be suspended').toBe('suspended');
        expect(userDoc.subscription.product.id, `Product should still be ${state.paidProductId}`).toBe(state.paidProductId);
      },
    },

    {
      name: 'send-recovery-webhook',
      async run({ http, expect, state, config, payments }) {
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + 1);

        state.eventId2 = `_test-evt-journey-suspend-recover-${Date.now()}`;

        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.eventId2,
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: state.subscriptionId,
              object: 'subscription',
              status: 'active',
              metadata: { uid: state.uid, orderId: state.orderId },
              cancel_at_period_end: false,
              canceled_at: null,
              current_period_end: Math.floor(futureDate.getTime() / 1000),
              current_period_start: Math.floor(Date.now() / 1000),
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
      name: 'subscription-recovered',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId2}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId2}`);
        expect(webhookDoc.transition, 'Transition should be payment-recovered').toBe('payment-recovered');

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.status, 'Status should be active again').toBe('active');
        expect(userDoc.subscription.product.id, `Product should still be ${state.paidProductId}`).toBe(state.paidProductId);
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
        expect(orderDoc.requests.cancellation, 'requests.cancellation should be null').toBe(null);
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
