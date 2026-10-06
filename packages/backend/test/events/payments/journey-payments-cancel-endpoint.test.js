/**
 * Test: Payment Journey - Cancel via endpoint
 * Simulates: paid active → POST /payments/cancel → cancellation pending
 *
 * The test provider's cancelAtPeriodEnd writes a Stripe-shaped webhook doc directly
 * to payments-webhooks/{eventId}, triggering the full on-write pipeline automatically.
 * Product-agnostic: resolves the first paid product from config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: cancel endpoint → cancellation pending',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'setup-paid-subscription',
      async run({ accounts, firestore, expect, state, config, http, waitFor, skip, payments }) {
        const uid = accounts['journey-payments-cancel-route'].uid;
        // Resolve first paid product from config. If the brand has none configured,
        // skip the entire journey — this is a config-gap, not a code failure.
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);
        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        state.uid = uid;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];
        // Create subscription via test intent — auto-fires webhook pipeline
        const response = await http.as('journey-payments-cancel-route').post('omega/payments/intent', {
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
        expect(userDoc.subscription?.product?.id, `Should be ${paidProduct.id}`).toBe(paidProduct.id);
        expect(userDoc.subscription?.status, 'Should be active').toBe('active');
        expect(userDoc.subscription?.cancellation?.pending, 'Should not be pending cancellation').toBe(false);
      },
    },

    {
      name: 'call-cancel-endpoint',
      async run({ http, expect }) {
        // Test provider writes a payments-webhooks doc directly,
        // triggering the on-write pipeline automatically — no manual webhook needed.
        // skipGuards bypasses the 24-hour subscription-age guard.
        const response = await http.as('journey-payments-cancel-route').post('omega/payments/cancel', {
          confirmed: true,
          reason: 'Too expensive',
          feedback: 'Would return at a lower price',
          skipGuards: true,
        });

        expect(response, 'Cancel endpoint should succeed').toBeSuccess();
        expect(response.data.success, 'Should return { success: true }').toBe(true);
      },
    },

    {
      name: 'verify-cancellation-pending',
      async run({ firestore, expect, state, waitFor }) {
        // Poll user doc until the on-write pipeline updates subscription state
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.cancellation?.pending === true;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);
        expect(userDoc.subscription.status, 'Status should still be active').toBe('active');
        expect(userDoc.subscription.cancellation.pending, 'Cancellation should be pending').toBe(true);
        expect(userDoc.subscription.cancellation.date.timestampUNIX > 0, 'Cancellation date should be set').toBeTruthy();
      },
    },

    {
      name: 'cancellation-request-stored',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.requests, 'requests field should exist').toBeTruthy();
        expect(orderDoc.requests.cancellation, 'requests.cancellation should be populated').toBeTruthy();
        expect(orderDoc.requests.cancellation.reason, 'Cancellation reason should match').toBe('Too expensive');
        expect(orderDoc.requests.cancellation.feedback, 'Cancellation feedback should match').toBe('Would return at a lower price');
        expect(orderDoc.requests.cancellation.date.timestampUNIX > 0, 'Cancellation date should be set').toBeTruthy();
        expect(orderDoc.requests.refund, 'requests.refund should still be null').toBe(null);
      },
    },
  ],
});
