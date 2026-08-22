/**
 * Test: Payment Journey - Refund with no order doc ([#216](https://github.com/Omega-JS-Stack/omega/issues/216))
 * Simulates: paid, pending cancellation, WITHOUT an order doc → POST /payments/refund → cancelled, product intact
 *
 * The same hole #210 fixed in the cancel provider: the refund test provider
 * resolved the plan's product from the payments-orders doc only, so a paid user
 * with no order got a webhook carrying plan.product = null — the pipeline
 * resolved that to Basic and downgraded the user mid-refund instead of recording
 * a cancelled paid subscription. The product falls back to the subscription's own.
 *
 * The refund-no-order persona is seeded paid + pending cancellation on the test
 * provider with payment.orderId null. Product-agnostic: the persona's 'premium'
 * is remapped to the brand's first paid product at seed time, and the assertions
 * compare against whatever the user doc starts with.
 */
module.exports = {
  description: 'Payment journey: refund with no order doc → cancelled, product intact',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'starts-paid-with-no-order',
      async run({ accounts, firestore, assert, state }) {
        const uid = accounts['refund-no-order'].uid;
        state.uid = uid;

        const userDoc = await firestore.get(`users/${uid}`);

        assert.ok(userDoc, 'User doc should exist');
        assert.notEqual(userDoc.subscription?.product?.id, 'basic', 'Persona should start on a paid product');
        assert.equal(userDoc.subscription?.status, 'active', 'Should be active');
        assert.equal(userDoc.subscription?.cancellation?.pending, true, 'Refund requires a pending cancellation');
        assert.equal(userDoc.subscription?.payment?.provider, 'test', 'Should be on the test provider');
        assert.equal(userDoc.subscription?.payment?.orderId, null, 'The bug scenario needs no order doc');

        state.paidProductId = userDoc.subscription.product.id;
      },
    },

    {
      name: 'call-refund-endpoint',
      async run({ http, assert }) {
        // The test provider writes a payments-webhooks doc directly, triggering the
        // on-write pipeline automatically — no manual webhook needed.
        const response = await http.as('refund-no-order').post('backend-manager/payments/refund', {
          confirmed: true,
          reason: 'Not satisfied with the service',
        });

        assert.isSuccess(response, 'Refund endpoint should succeed');
        assert.equal(response.data.success, true, 'Should return { success: true }');
      },
    },

    {
      name: 'verify-cancelled-and-product-intact',
      async run({ firestore, assert, state, waitFor }) {
        // Wait for the pipeline to land either outcome: the cancellation (correct) or the
        // downgrade to Basic (the bug) — so the regression fails on its assertion, not a timeout.
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.status === 'cancelled'
            || userDoc?.subscription?.product?.id === 'basic';
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        assert.equal(userDoc.subscription.product.id, state.paidProductId, `Product should stay ${state.paidProductId}, not fall back to Basic`);
        assert.equal(userDoc.subscription.status, 'cancelled', 'The refund cancels the subscription immediately');
      },
    },
  ],
};
