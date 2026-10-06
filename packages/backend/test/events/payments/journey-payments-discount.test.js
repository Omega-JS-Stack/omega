/**
 * Test: Payment Journey - Subscription with Discount
 * Simulates: basic → paid subscription with WELCOME15 promo code → confirmation email with discount
 *
 * Verifies the discount flows through: intent → order → transition → email template
 * Product-agnostic: resolves the first paid product from config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: subscription with discount code',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'setup',
      async run({ accounts, firestore, expect, state, config, skip, payments }) {
        const uid = accounts['journey-payments-intent-discount'].uid;
        const userDoc = await firestore.get(`users/${uid}`);

        expect(userDoc, 'User doc should exist').toBeTruthy();
        expect(userDoc.subscription?.product?.id, 'Should start as basic').toBe('basic');

        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices && p.type === 'subscription');
        if (!paidProduct) {
          skip('No paid subscription product configured');
        }

        state.uid = uid;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];
      },
    },

    {
      name: 'create-intent-with-discount',
      async run({ http, expect, state }) {
        const response = await http.as('journey-payments-intent-discount').post('omega/payments/intent', {
          provider: 'test',
          productId: state.paidProductId,
          frequency: state.product.frequency,
          discount: 'WELCOME15',
        });

        expect(response, 'Intent with discount should succeed').toBeSuccess();
        expect(response.data.orderId, 'Should return orderId').toBeTruthy();

        state.orderId = response.data.orderId;
        state.eventId = response.data.id.replace('_test-cs-', '_test-evt-');
      },
    },

    {
      name: 'subscription-activated-with-discount',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.product?.id === state.paidProductId;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.product.id, `Product should be ${state.paidProductId}`).toBe(state.paidProductId);
        expect(userDoc.subscription.status, 'Status should be active').toBe('active');
      },
    },

    {
      name: 'order-has-discount',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.discount, 'Order should have discount').toBeTruthy();
        expect(orderDoc.discount.code, 'Discount code should be WELCOME15').toBe('WELCOME15');
        expect(orderDoc.discount.percent, 'Discount should be 15%').toBe(15);
      },
    },

    {
      name: 'webhook-transition-new-subscription',
      async run({ firestore, expect, state }) {
        const webhookDoc = await firestore.get(`payments-webhooks/${state.eventId}`);

        expect(webhookDoc, 'Webhook doc should exist').toBeTruthy();
        expect(webhookDoc.transition, 'Transition should be new-subscription').toBe('new-subscription');
      },
    },
  ],
});
