/**
 * Test: Payment Journey - Plan Change
 * Simulates: basic → paid product A → plan-changed webhook → paid product B
 *
 * Uses test intent for initial subscription, then manual webhook to change plans.
 * Requires at least two paid subscription products in config.
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: paid product A → plan-changed → paid product B',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'setup-paid-subscription',
      async run({ accounts, firestore, expect, state, config, http, waitFor, skip, payments }) {
        const uid = accounts['journey-payments-plan-change'].uid;

        // Resolve two distinct paid subscription products from config. If the brand
        // has fewer than two, skip the journey — this is a config-gap, not a code failure.
        const paidProducts = config.payment.products.filter(p => p.id !== 'basic' && p.type === 'subscription' && p.prices);
        if (paidProducts.length < 2) {
          skip('Fewer than two paid subscription products configured in this brand');
        }

        const productA = paidProducts[0];
        const productB = paidProducts[1];

        state.uid = uid;
        state.productA = payments.products[productA.id];
        state.productB = payments.products[productB.id];

        // Create subscription via test intent (product A)
        const response = await http.as('journey-payments-plan-change').post('omega/payments/intent', {
          provider: 'test',
          productId: productA.id,
          frequency: state.productA.frequency,
        });
        expect(response, 'Intent should succeed').toBeSuccess();
        state.orderId = response.data.orderId;

        // Wait for subscription to activate
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.product?.id === productA.id;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${uid}`);
        expect(userDoc.subscription?.product?.id, `Should start as ${productA.id}`).toBe(productA.id);
        expect(userDoc.subscription?.status, 'Should be active').toBe('active');

        state.subscriptionId = userDoc.subscription.payment.resourceId;
      },
    },

    {
      name: 'send-plan-change-webhook',
      async run({ http, expect, state, config, payments }) {
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + 1);

        state.eventId = `_test-evt-journey-plan-change-${Date.now()}`;

        // Send subscription.updated with product B's Stripe product ID (or test sentinel)
        const response = await http.as('none').post(`omega/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.eventId,
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
              start_date: Math.floor(Date.now() / 1000) - 86400 * 30,
              trial_start: null,
              trial_end: null,
              plan: { product: payments.stripeProductIds[state.productB.id], interval: state.productB.interval },
            },
          },
        });

        expect(response, 'Webhook should be accepted').toBeSuccess();
      },
    },

    {
      name: 'plan-changed-transition-detected',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);
        expect(webhookDoc, 'Webhook doc should exist').toBeTruthy();
        expect(webhookDoc.transition, 'Transition should be plan-changed').toBe('plan-changed');
      },
    },

    {
      name: 'subscription-updated-to-product-b',
      async run({ firestore, expect, state }) {
        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.product.id, `Product should be ${state.productB.id}`).toBe(state.productB.id);
        expect(userDoc.subscription.product.name, `Product name should be ${state.productB.name}`).toBe(state.productB.name);
        expect(userDoc.subscription.status, 'Status should still be active').toBe('active');
        expect(userDoc.subscription.payment.provider, 'Provider should be test').toBe('test');
        expect(userDoc.subscription.payment.frequency, `Frequency should be ${state.productB.frequency}`).toBe(state.productB.frequency);
        expect(userDoc.subscription.payment.resourceId, 'Resource ID should be the same subscription').toBe(state.subscriptionId);
      },
    },

    {
      name: 'order-doc-updated',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.unified.product.id, `Order product should be ${state.productB.id}`).toBe(state.productB.id);
        expect(orderDoc.unified.status, 'Order status should be active').toBe('active');
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
