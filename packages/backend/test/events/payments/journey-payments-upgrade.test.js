/**
 * Test: Payment Journey - Upgrade
 * Simulates: basic user → test intent → auto-webhook → paid active subscription
 *
 * Uses the test provider to exercise the full intent→webhook→trigger pipeline
 * Product-agnostic: resolves the first paid product from config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: basic → paid upgrade via test intent',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'verify-starts-as-basic',
      async run({ accounts, firestore, expect, state, config, skip, payments }) {
        const uid = accounts['journey-payments-upgrade'].uid;
        const userDoc = await firestore.get(`users/${uid}`);

        expect(userDoc, 'User doc should exist').toBeTruthy();
        expect(userDoc.subscription?.product?.id, 'Should start as basic').toBe('basic');
        expect(userDoc.subscription?.status, 'Should be active').toBe('active');

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
      },
    },

    {
      name: 'create-test-intent',
      async run({ http, expect, state }) {
        const response = await http.as('journey-payments-upgrade').post('omega/payments/intent', {
          provider: 'test',
          productId: state.paidProductId,
          frequency: state.product.frequency,
        });

        expect(response, 'Intent should succeed').toBeSuccess();
        expect(response.data.id, 'Should return intent ID').toBeTruthy();
        expect(response.data.orderId, 'Should return orderId').toBeTruthy();
        expect(response.data.orderId, 'orderId should be XXXX-XXXX-XXXX format').toMatch(/^\d{4}-\d{4}-\d{4}$/);
        expect(response.data.url, 'Should return URL').toBeTruthy();

        state.intentId = response.data.id;
        state.orderId = response.data.orderId;

        // Derive webhook event ID from intent ID (same timestamp)
        state.eventId = response.data.id.replace('_test-cs-', '_test-evt-');
      },
    },

    {
      name: 'subscription-activated',
      async run({ firestore, expect, state, waitFor }) {
        // Poll user doc until subscription changes from basic to paid
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.product?.id === state.paidProductId;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.product.id, `Product should be ${state.paidProductId}`).toBe(state.paidProductId);
        expect(userDoc.subscription.status, 'Status should be active').toBe('active');
        expect(userDoc.subscription.payment.provider, 'Provider should be test').toBe('test');
        expect(userDoc.subscription.payment.orderId, 'Order ID should match intent').toBe(state.orderId);
        expect(userDoc.subscription.payment.resourceId, 'Resource ID should be set').toBeTruthy();
        expect(userDoc.subscription.payment.frequency, 'Frequency should be monthly').toBe(state.product.frequency);
        expect(userDoc.subscription.cancellation.pending, 'Should not be pending cancellation').toBe(false);

        state.subscriptionId = userDoc.subscription.payment.resourceId;
      },
    },

    {
      name: 'order-doc-created',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.id, 'ID should match orderId').toBe(state.orderId);
        expect(orderDoc.type, 'Type should be subscription').toBe('subscription');
        expect(orderDoc.owner, 'Owner should match').toBe(state.uid);
        expect(orderDoc.provider, 'Provider should be test').toBe('test');
        expect(orderDoc.resourceId, 'Resource ID should match').toBe(state.subscriptionId);
        expect(orderDoc.unified.product.id, `Product should be ${state.paidProductId}`).toBe(state.paidProductId);
        expect(orderDoc.unified.status, 'Status should be active').toBe('active');
        expect(orderDoc.requests !== undefined, 'requests field should exist').toBeTruthy();
        expect(orderDoc.requests.cancellation, 'requests.cancellation should be null initially').toBe(null);
        expect(orderDoc.requests.refund, 'requests.refund should be null initially').toBe(null);
      },
    },

    {
      name: 'webhook-transition-new-subscription',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);
        expect(webhookDoc, 'Webhook doc should exist').toBeTruthy();
        expect(webhookDoc.transition, 'Transition should be new-subscription').toBe('new-subscription');
        expect(webhookDoc.orderId, 'Webhook doc orderId should match intent').toBe(state.orderId);
      },
    },

    {
      name: 'intent-doc-completed',
      async run({ firestore, expect, state }) {
        const intentDoc = await firestore.get(`payments-intents/${state.orderId}`);

        expect(intentDoc, 'Intent doc should exist').toBeTruthy();
        expect(intentDoc.id, 'ID should match orderId').toBe(state.orderId);
        expect(intentDoc.intentId, 'Intent ID should match provider session ID').toBe(state.intentId);
        expect(intentDoc.owner, 'Owner should match').toBe(state.uid);
        expect(intentDoc.provider, 'Provider should be test').toBe('test');
        expect(intentDoc.status, 'Intent status should be completed after webhook processing').toBe('completed');
        expect(intentDoc.productId, `Product should be ${state.paidProductId}`).toBe(state.paidProductId);
        expect(intentDoc.metadata?.completed?.timestampUNIX > 0, 'Completed timestamp should be set').toBeTruthy();
      },
    },
  ],
});
