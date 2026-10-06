/**
 * Test: Payment Journey - Trial Cancel
 * Simulates: basic user → trial activation → cancel during trial → immediate cancellation
 *
 * When a user cancels during a free trial, the subscription should be cancelled immediately
 * (not scheduled for period end) to avoid giving free premium access for the remainder of the trial.
 *
 * Uses the test provider for initial trial, then cancel endpoint for cancellation.
 * Product-agnostic: resolves the first paid product from config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: trial → cancel during trial → immediate cancellation',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'verify-starts-as-basic',
      async run({ accounts, firestore, expect, state, config, skip, payments }) {
        const uid = accounts['journey-payments-trial-cancel'].uid;
        const userDoc = await firestore.get(`users/${uid}`);

        expect(userDoc, 'User doc should exist').toBeTruthy();
        expect(userDoc.subscription?.product?.id, 'Should start as basic').toBe('basic');
        expect(userDoc.subscription?.trial?.claimed, 'Trial should not be claimed').toBe(false);

        // Resolve first paid product with trial from config. If the brand has none
        // configured, skip the entire journey — this is a config-gap, not a code failure.
        const trialProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices && p.trial?.days);
        if (!trialProduct) {
          skip('No paid product with trial configured in this brand');
        }

        state.uid = uid;
        state.paidProductId = trialProduct.id;
        state.paidProductName = trialProduct.name;
        state.product = payments.products[trialProduct.id];
      },
    },

    {
      name: 'create-trial-intent',
      async run({ http, expect, state }) {
        const response = await http.as('journey-payments-trial-cancel').post('omega/payments/intent', {
          provider: 'test',
          productId: state.paidProductId,
          frequency: state.product.frequency,
          trial: true,
        });

        expect(response, 'Intent should succeed').toBeSuccess();
        expect(response.data.id, 'Should return intent ID').toBeTruthy();
        expect(response.data.orderId, 'Should return orderId').toBeTruthy();

        state.intentId = response.data.id;
        state.orderId = response.data.orderId;
        state.eventId = response.data.id.replace('_test-cs-', '_test-evt-');
      },
    },

    {
      name: 'trial-activated',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.trial?.claimed === true;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.product.id, `Product should be ${state.paidProductId}`).toBe(state.paidProductId);
        expect(userDoc.subscription.status, 'Status should be active').toBe('active');
        expect(userDoc.subscription.trial.claimed, 'Trial should be claimed').toBe(true);
        expect(userDoc.subscription.trial.expires.timestampUNIX, 'Trial expires should match subscription expires (still in trial period)').toBe(userDoc.subscription.expires.timestampUNIX);

        state.subscriptionId = userDoc.subscription.payment.resourceId;
      },
    },

    {
      name: 'cancel-during-trial',
      async run({ http, expect }) {
        // Cancel via endpoint — test provider should detect trial and simulate immediate cancel.
        // skipGuards bypasses the 24-hour subscription-age guard.
        const response = await http.as('journey-payments-trial-cancel').post('omega/payments/cancel', {
          confirmed: true,
          reason: 'Changed my mind during trial',
          feedback: 'Testing trial cancellation',
          skipGuards: true,
        });

        expect(response, 'Cancel endpoint should succeed').toBeSuccess();
        expect(response.data.success, 'Should return { success: true }').toBe(true);
      },
    },

    {
      name: 'verify-immediate-cancellation',
      async run({ firestore, expect, state, waitFor }) {
        // Poll until subscription is cancelled (NOT just pending)
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.status === 'cancelled';
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        // During trial cancel: subscription should be immediately cancelled, not pending
        expect(userDoc.subscription.status, 'Status should be cancelled (not active with pending)').toBe('cancelled');
        expect(userDoc.subscription.cancellation.pending, 'Should NOT be pending — should be fully cancelled').toBe(false);
        expect(userDoc.subscription.product.id, `Product should still be ${state.paidProductId}`).toBe(state.paidProductId);
      },
    },

    {
      name: 'cancellation-request-stored',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.requests, 'requests field should exist').toBeTruthy();
        expect(orderDoc.requests.cancellation, 'requests.cancellation should be populated').toBeTruthy();
        expect(orderDoc.requests.cancellation.reason, 'Cancellation reason should match').toBe('Changed my mind during trial');
        expect(orderDoc.requests.cancellation.feedback, 'Cancellation feedback should match').toBe('Testing trial cancellation');
        expect(orderDoc.requests.cancellation.date.timestampUNIX > 0, 'Cancellation date should be set').toBeTruthy();
        expect(orderDoc.requests.refund, 'requests.refund should still be null').toBe(null);
      },
    },
  ],
});
