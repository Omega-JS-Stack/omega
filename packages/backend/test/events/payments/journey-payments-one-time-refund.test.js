/**
 * Test: Payment Journey - One-Time Purchase Refunded
 * Simulates: user → test intent (one-time product) → purchase-completed → POST /payments/refund
 *            → charge.refunded webhook → purchase-refunded
 *
 * The refund of a one-time purchase is its own path end to end: the subject is
 * the `payments-orders` doc (a one-time purchase never touches the user doc), the
 * provider refunds the payment behind that order, and the resulting
 * `charge.refunded` webhook carries no subscription — so it is categorized
 * one-time and fires purchase-refunded ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * Requires at least one product with type: 'one-time' in config.payment.products
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Payment journey: one-time purchase → refund endpoint → purchase-refunded',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'resolve-one-time-product',
      async run({ accounts, firestore, expect, state, config, skip }) {
        const uid = accounts['journey-payments-one-time-refund'].uid;
        const userDoc = await firestore.get(`users/${uid}`);

        expect(userDoc, 'User doc should exist').toBeTruthy();

        // Resolve first one-time product from config. If the brand has none configured,
        // skip the entire journey — this is a config-gap, not a code failure.
        const oneTimeProduct = config.payment.products.find(p => p.type === 'one-time' && p.prices?.once);
        if (!oneTimeProduct) {
          skip('No one-time product configured in this brand');
        }

        state.uid = uid;
        state.productId = oneTimeProduct.id;
        state.price = oneTimeProduct.prices.once;

        // Snapshot subscription before the purchase — a one-time refund must not touch it
        state.subscriptionBefore = userDoc.subscription || null;
      },
    },

    {
      name: 'buy-the-one-time-product',
      async run({ http, firestore, expect, state, waitFor }) {
        const response = await http.as('journey-payments-one-time-refund').post('omega/payments/intent', {
          provider: 'test',
          productId: state.productId,
        });

        expect(response, 'Intent should succeed').toBeSuccess();

        state.orderId = response.data.orderId;
        state.purchaseEventId = response.data.id.replace('_test-cs-', '_test-evt-');

        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.purchaseEventId}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.type, 'Type should be one-time').toBe('one-time');
        expect(orderDoc.requests.refund, 'The purchase should start un-refunded').toBe(null);

        // What the purchase IS, before any refund touches it — the refund updates
        // this record, it never redefines it
        state.purchase = {
          productId: orderDoc.productId,
          productName: orderDoc.unified?.product?.name,
          price: orderDoc.unified?.payment?.price,
          resourceId: orderDoc.resourceId,
          paymentResourceId: orderDoc.unified?.payment?.resourceId,
        };

        expect(state.purchase.productId, 'The purchase should record the product bought').toBe(state.productId);
        expect(state.purchase.price, 'The purchase should record what it cost').toBe(state.price);
      },
    },

    {
      name: 'refund-the-purchase',
      async run({ http, expect, state }) {
        const response = await http.as('journey-payments-one-time-refund').post('omega/payments/refund', {
          confirmed: true,
          reason: 'Bought the wrong thing',
          feedback: 'Testing the one-time refund flow',
          orderId: state.orderId,
        });

        expect(response, 'Refund should succeed').toBeSuccess();
        expect(response.data.success, 'Should return success: true').toBeTruthy();
        expect(response.data.refund, 'Should return refund details').toBeTruthy();
        expect(response.data.refund.amount, 'A one-time purchase refunds its full price').toBe(state.price);
        expect(response.data.refund.full, 'A one-time refund is always full — there is no period to prorate').toBe(true);
      },
    },

    {
      name: 'refund-request-stored-on-the-order',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc.requests?.refund, 'The refund request should be stored on the order').toBeTruthy();
        expect(orderDoc.requests.refund.reason, 'The reason should be stored').toBe('Bought the wrong thing');
        expect(orderDoc.requests.refund.feedback, 'The feedback should be stored').toBe('Testing the one-time refund flow');
        expect(orderDoc.requests.refund.full, 'The stored request should record a full refund').toBe(true);
        expect(orderDoc.requests.refund.date?.timestampUNIX > 0, 'The refund date should be stamped').toBeTruthy();
      },
    },

    {
      name: 'refund-webhook-fires-purchase-refunded',
      async run({ firestore, expect, state, waitFor }) {
        // The test provider writes the synthetic charge.refunded doc itself, so its
        // event id is not knowable here — find it by owner + event type.
        const webhookDoc = await waitFor(async () => {
          const snapshot = await firestore.collection('payments-webhooks')
            .where('owner', '==', state.uid)
            .where('event.type', '==', 'charge.refunded')
            .get();

          const doc = snapshot.docs.map(d => d.data()).find(d => d.status === 'completed' || d.status === 'failed');
          return doc || null;
        }, 15000, 500);

        expect(webhookDoc.status, `The refund webhook should complete (error: ${webhookDoc.error || 'none'})`).toBe('completed');
        expect(webhookDoc.event.category, 'A refund with no subscription is a one-time event').toBe('one-time');
        expect(webhookDoc.transition, 'Transition should be purchase-refunded').toBe('purchase-refunded');
        expect(webhookDoc.orderId, 'The refund should resolve back to the order it refunded').toBe(state.orderId);
      },
    },

    {
      name: 'the-purchase-record-survives-the-refund',
      async run({ firestore, expect, state }) {
        // The refund event carries the CHARGE that moved the money back — a bare
        // charge names no product and no price. Re-deriving the order from it
        // degraded the purchase to product=unknown / price=0 and replaced the
        // checkout resourceId with the charge id, so the buyer's order silently
        // stopped saying what they bought ([#212]).
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc.productId, 'The refunded order should still name the product bought').toBe(state.purchase.productId);
        expect(orderDoc.unified.product.id, 'The unified product should survive the refund').toBe(state.purchase.productId);
        expect(orderDoc.unified.product.name, 'The product name should survive the refund').toBe(state.purchase.productName);
        expect(orderDoc.unified.payment.price, 'The price paid should survive the refund').toBe(state.purchase.price);
        expect(orderDoc.resourceId, 'The order should still point at the checkout resource, not the charge').toBe(state.purchase.resourceId);
        expect(orderDoc.unified.payment.resourceId, 'The unified payment resource should still be the checkout resource').toBe(state.purchase.paymentResourceId);

        // What the refund DOES change: the outcome
        expect(orderDoc.unified.status, 'The purchase should now read as refunded').toBe('refunded');
        expect(parseFloat(orderDoc.unified.payment.refund.amount), 'The refunded amount should be recorded on the order').toBe(state.price);
        expect(orderDoc.unified.payment.refund.currency, 'The refunded currency should be recorded').toBe('USD');
        expect(orderDoc.unified.payment.refund.date?.timestampUNIX > 0, 'The refund should be dated').toBeTruthy();

        // The endpoint's own record is untouched by the webhook that followed it
        expect(orderDoc.requests.refund.reason, 'The refund request should still be on the order').toBe('Bought the wrong thing');
      },
    },

    {
      name: 'subscription-unchanged',
      async run({ firestore, expect, state }) {
        // A one-time refund must NOT modify users/{uid}.subscription
        const userDoc = await firestore.get(`users/${state.uid}`);
        const subAfter = userDoc.subscription || null;

        expect(subAfter?.product?.id, 'Subscription product should be unchanged after a one-time refund').toBe(state.subscriptionBefore?.product?.id);
        expect(subAfter?.status, 'Subscription status should be unchanged after a one-time refund').toBe(state.subscriptionBefore?.status);
      },
    },
  ],
});
