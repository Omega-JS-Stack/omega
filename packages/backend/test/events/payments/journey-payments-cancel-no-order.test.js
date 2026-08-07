/**
 * Test: Payment Journey - Cancel with no order doc ([#210](https://github.com/Omega-JS-Stack/omega/issues/210))
 * Simulates: paid active WITHOUT an order doc → POST /payments/cancel → cancellation pending
 *
 * The cancel test processor resolved the plan's product from the payments-orders doc only,
 * so a paid user with no order got a webhook carrying plan.product = null — the pipeline
 * resolved that to Basic and downgraded the user mid-cancel instead of scheduling the
 * cancellation. The product falls back to the subscription's own product.
 *
 * The cancel-no-order persona is seeded paid on the test processor with payment.orderId null.
 * Product-agnostic: the persona's 'premium' is remapped to the brand's first paid product at
 * seed time, and the assertions compare against whatever the user doc starts with.
 */
module.exports = {
  description: 'Payment journey: cancel with no order doc → cancellation pending, product intact',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'starts-paid-with-no-order',
      async run({ accounts, firestore, assert, state }) {
        const uid = accounts['cancel-no-order'].uid;
        state.uid = uid;

        const userDoc = await firestore.get(`users/${uid}`);

        assert.ok(userDoc, 'User doc should exist');
        assert.notEqual(userDoc.subscription?.product?.id, 'basic', 'Persona should start on a paid product');
        assert.equal(userDoc.subscription?.status, 'active', 'Should be active');
        assert.equal(userDoc.subscription?.cancellation?.pending, false, 'Should not be pending cancellation');
        assert.equal(userDoc.subscription?.payment?.processor, 'test', 'Should be on the test processor');
        assert.equal(userDoc.subscription?.payment?.orderId, null, 'The bug scenario needs no order doc');

        state.paidProductId = userDoc.subscription.product.id;
      },
    },

    {
      name: 'call-cancel-endpoint',
      async run({ http, assert }) {
        // The test processor writes a payments-webhooks doc directly, triggering the
        // on-write pipeline automatically — no manual webhook needed.
        const response = await http.as('cancel-no-order').post('backend-manager/payments/cancel', {
          confirmed: true,
          reason: 'No longer needed',
        });

        assert.isSuccess(response, 'Cancel endpoint should succeed');
        assert.equal(response.data.success, true, 'Should return { success: true }');
      },
    },

    {
      name: 'verify-cancellation-pending-and-product-intact',
      async run({ firestore, assert, state, waitFor }) {
        // Wait for the pipeline to land either outcome: the cancellation (correct) or the
        // downgrade to Basic (the bug) — so the regression fails on its assertion, not a timeout.
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.cancellation?.pending === true
            || userDoc?.subscription?.product?.id === 'basic';
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        assert.equal(userDoc.subscription.product.id, state.paidProductId, `Product should stay ${state.paidProductId}, not fall back to Basic`);
        assert.equal(userDoc.subscription.status, 'active', 'Status should still be active');
        assert.equal(userDoc.subscription.cancellation.pending, true, 'Cancellation should be pending');
        assert.ok(userDoc.subscription.cancellation.date.timestampUNIX > 0, 'Cancellation date should be set');
      },
    },
  ],
};
