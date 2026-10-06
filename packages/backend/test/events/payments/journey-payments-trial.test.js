/**
 * Test: Payment Journey - Trial
 * Simulates: basic user → trial activation via test intent → trial ends → active paid
 *
 * Uses the test provider for initial trial, then manual webhook for trial-to-active
 * Product-agnostic: resolves the first paid product from config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: basic → trial → active paid via test provider',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'verify-starts-as-basic',
      async run({ accounts, firestore, expect, state, config, skip, payments }) {
        const uid = accounts['journey-payments-trial'].uid;
        const userDoc = await firestore.get(`users/${uid}`);

        expect(userDoc, 'User doc should exist').toBeTruthy();
        expect(userDoc.subscription?.product?.id, 'Should start as basic').toBe('basic');
        expect(userDoc.subscription?.trial?.claimed, 'Trial should not be claimed').toBe(false);

        // Resolve first paid product WITH a trial from config. The test provider
        // only creates a trialing subscription when product.trial.days > 0, so a
        // brand whose paid products all have trial.days: 0 (e.g. trials disabled)
        // has nothing to exercise here — skip the journey. This is a config-gap,
        // not a code failure, and mirrors journey-payments-trial-cancel.js.
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices && p.trial?.days);
        if (!paidProduct) {
          skip('No paid product with trial configured in this brand');
        }

        state.uid = uid;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];
      },
    },

    {
      name: 'create-trial-intent',
      async run({ http, expect, state }) {
        const response = await http.as('journey-payments-trial').post('omega/payments/intent', {
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

        // Derive webhook event ID from intent ID (same timestamp)
        state.eventId = response.data.id.replace('_test-cs-', '_test-evt-');
      },
    },

    {
      name: 'trial-activated',
      async run({ firestore, expect, state, waitFor }) {
        // Poll until trial subscription appears
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.trial?.claimed === true;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.product.id, `Product should be ${state.paidProductId}`).toBe(state.paidProductId);
        expect(userDoc.subscription.status, 'Status should be active').toBe('active');
        expect(userDoc.subscription.trial.claimed, 'Trial should be claimed').toBe(true);
        expect(userDoc.subscription.payment.orderId, 'Order ID should match intent').toBe(state.orderId);

        state.subscriptionId = userDoc.subscription.payment.resourceId;

        // Verify the auto-fired webhook triggered new-subscription (trial is a property, not a separate transition)
        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);
        expect(webhookDoc, 'Webhook doc should exist').toBeTruthy();
        expect(webhookDoc.transition, 'Transition should be new-subscription (trial detected inside handler)').toBe('new-subscription');
        expect(webhookDoc.orderId, 'Webhook doc orderId should match intent').toBe(state.orderId);
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

    {
      name: 'order-doc-created',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.id, 'ID should match orderId').toBe(state.orderId);
        expect(orderDoc.type, 'Type should be subscription').toBe('subscription');
        expect(orderDoc.owner, 'Owner should match').toBe(state.uid);
        expect(orderDoc.unified.product.id, `Product should be ${state.paidProductId}`).toBe(state.paidProductId);
        expect(orderDoc.unified.trial.claimed, 'Trial should be claimed').toBe(true);
        expect(orderDoc.requests !== undefined, 'requests field should exist').toBeTruthy();
        expect(orderDoc.requests.cancellation, 'requests.cancellation should be null').toBe(null);
        expect(orderDoc.requests.refund, 'requests.refund should be null').toBe(null);
      },
    },

    {
      name: 'send-trial-to-active-webhook',
      async run({ http, expect, state, config, payments }) {
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + 1);

        state.eventId2 = `_test-evt-journey-trial-active-${Date.now()}`;

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
              start_date: Math.floor(Date.now() / 1000) - 86400 * 14,
              trial_start: Math.floor(Date.now() / 1000) - 86400 * 14,
              trial_end: Math.floor(Date.now() / 1000),
              plan: { product: payments.stripeProductIds[state.paidProductId], interval: state.product.interval },
            },
          },
        });

        expect(response, 'Webhook should be accepted').toBeSuccess();
      },
    },

    {
      name: 'trial-transitioned-to-active',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.eventId2}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        // Trial → active paid is the same status/product, so no transition fires
        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId2}`);
        expect(webhookDoc.transition, 'No transition (same status/product, trial already claimed)').toBe(null);

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.product.id, `Product should be ${state.paidProductId}`).toBe(state.paidProductId);
        expect(userDoc.subscription.status, 'Status should be active').toBe('active');
        expect(userDoc.subscription.trial.claimed, 'Trial should remain claimed (historical)').toBe(true);
        expect(userDoc.subscription.payment.frequency, `Frequency should be ${state.product.frequency}`).toBe(state.product.frequency);
      },
    },
  ],
});
