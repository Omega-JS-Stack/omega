/**
 * Test: Payment Journey - Cancel with no order doc ([#210](https://github.com/Omega-JS-Stack/omega/issues/210))
 * Simulates: paid active WITHOUT an order doc → POST /payments/cancel → cancellation pending
 *
 * The cancel test provider resolved the plan's product from the payments-orders doc only,
 * so a paid user with no order got a webhook carrying plan.product = null — the pipeline
 * resolved that to Basic and downgraded the user mid-cancel instead of scheduling the
 * cancellation. The product falls back to the subscription's own product.
 *
 * The cancel-no-order persona is seeded paid on the test provider with payment.orderId null.
 * Product-agnostic: the persona's 'premium' is remapped to the brand's first paid product at
 * seed time, and the assertions compare against whatever the user doc starts with.
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: cancel with no order doc → cancellation pending, product intact',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'starts-paid-with-no-order',
      async run({ accounts, firestore, expect, state }) {
        const uid = accounts['cancel-no-order'].uid;
        state.uid = uid;

        const userDoc = await firestore.get(`users/${uid}`);

        expect(userDoc, 'User doc should exist').toBeTruthy();
        expect(userDoc.subscription?.product?.id, 'Persona should start on a paid product').not.toBe('basic');
        expect(userDoc.subscription?.status, 'Should be active').toBe('active');
        expect(userDoc.subscription?.cancellation?.pending, 'Should not be pending cancellation').toBe(false);
        expect(userDoc.subscription?.payment?.provider, 'Should be on the test provider').toBe('test');
        expect(userDoc.subscription?.payment?.orderId, 'The bug scenario needs no order doc').toBe(null);

        state.paidProductId = userDoc.subscription.product.id;
      },
    },

    {
      name: 'call-cancel-endpoint',
      async run({ http, expect }) {
        // The test provider writes a payments-webhooks doc directly, triggering the
        // on-write pipeline automatically — no manual webhook needed.
        const response = await http.as('cancel-no-order').post('omega/payments/cancel', {
          confirmed: true,
          reason: 'No longer needed',
        });

        expect(response, 'Cancel endpoint should succeed').toBeSuccess();
        expect(response.data.success, 'Should return { success: true }').toBe(true);
      },
    },

    {
      name: 'verify-cancellation-pending-and-product-intact',
      async run({ firestore, expect, state, waitFor }) {
        // Wait for the pipeline to land either outcome: the cancellation (correct) or the
        // downgrade to Basic (the bug) — so the regression fails on its assertion, not a timeout.
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.cancellation?.pending === true
            || userDoc?.subscription?.product?.id === 'basic';
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.product.id, `Product should stay ${state.paidProductId}, not fall back to Basic`).toBe(state.paidProductId);
        expect(userDoc.subscription.status, 'Status should still be active').toBe('active');
        expect(userDoc.subscription.cancellation.pending, 'Cancellation should be pending').toBe(true);
        expect(userDoc.subscription.cancellation.date.timestampUNIX > 0, 'Cancellation date should be set').toBeTruthy();
      },
    },
  ],
});
