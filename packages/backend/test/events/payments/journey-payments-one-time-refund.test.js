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
      async run({ accounts, firestore, assert, state, config, skip }) {
        const uid = accounts['journey-payments-one-time-refund'].uid;
        const userDoc = await firestore.get(`users/${uid}`);

        assert.ok(userDoc, 'User doc should exist');

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
      async run({ http, firestore, assert, state, waitFor }) {
        const response = await http.as('journey-payments-one-time-refund').post('backend-manager/payments/intent', {
          provider: 'test',
          productId: state.productId,
        });

        assert.isSuccess(response, 'Intent should succeed');

        state.orderId = response.data.orderId;
        state.purchaseEventId = response.data.id.replace('_test-cs-', '_test-evt-');

        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.purchaseEventId}`);
          return doc?.status === 'completed';
        }, 15000, 500);

        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        assert.ok(orderDoc, 'Order doc should exist');
        assert.equal(orderDoc.type, 'one-time', 'Type should be one-time');
        assert.equal(orderDoc.requests.refund, null, 'The purchase should start un-refunded');

        // What the purchase IS, before any refund touches it — the refund updates
        // this record, it never redefines it
        state.purchase = {
          productId: orderDoc.productId,
          productName: orderDoc.unified?.product?.name,
          price: orderDoc.unified?.payment?.price,
          resourceId: orderDoc.resourceId,
          paymentResourceId: orderDoc.unified?.payment?.resourceId,
        };

        assert.equal(state.purchase.productId, state.productId, 'The purchase should record the product bought');
        assert.equal(state.purchase.price, state.price, 'The purchase should record what it cost');
      },
    },

    {
      name: 'refund-the-purchase',
      async run({ http, assert, state }) {
        const response = await http.as('journey-payments-one-time-refund').post('backend-manager/payments/refund', {
          confirmed: true,
          reason: 'Bought the wrong thing',
          feedback: 'Testing the one-time refund flow',
          orderId: state.orderId,
        });

        assert.isSuccess(response, 'Refund should succeed');
        assert.ok(response.data.success, 'Should return success: true');
        assert.ok(response.data.refund, 'Should return refund details');
        assert.equal(response.data.refund.amount, state.price, 'A one-time purchase refunds its full price');
        assert.equal(response.data.refund.full, true, 'A one-time refund is always full — there is no period to prorate');
      },
    },

    {
      name: 'refund-request-stored-on-the-order',
      async run({ firestore, assert, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        assert.ok(orderDoc.requests?.refund, 'The refund request should be stored on the order');
        assert.equal(orderDoc.requests.refund.reason, 'Bought the wrong thing', 'The reason should be stored');
        assert.equal(orderDoc.requests.refund.feedback, 'Testing the one-time refund flow', 'The feedback should be stored');
        assert.equal(orderDoc.requests.refund.full, true, 'The stored request should record a full refund');
        assert.ok(orderDoc.requests.refund.date?.timestampUNIX > 0, 'The refund date should be stamped');
      },
    },

    {
      name: 'refund-webhook-fires-purchase-refunded',
      async run({ firestore, assert, state, waitFor }) {
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

        assert.equal(webhookDoc.status, 'completed', `The refund webhook should complete (error: ${webhookDoc.error || 'none'})`);
        assert.equal(webhookDoc.event.category, 'one-time', 'A refund with no subscription is a one-time event');
        assert.equal(webhookDoc.transition, 'purchase-refunded', 'Transition should be purchase-refunded');
        assert.equal(webhookDoc.orderId, state.orderId, 'The refund should resolve back to the order it refunded');
      },
    },

    {
      name: 'the-purchase-record-survives-the-refund',
      async run({ firestore, assert, state }) {
        // The refund event carries the CHARGE that moved the money back — a bare
        // charge names no product and no price. Re-deriving the order from it
        // degraded the purchase to product=unknown / price=0 and replaced the
        // checkout resourceId with the charge id, so the buyer's order silently
        // stopped saying what they bought ([#212]).
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        assert.equal(orderDoc.productId, state.purchase.productId, 'The refunded order should still name the product bought');
        assert.equal(orderDoc.unified.product.id, state.purchase.productId, 'The unified product should survive the refund');
        assert.equal(orderDoc.unified.product.name, state.purchase.productName, 'The product name should survive the refund');
        assert.equal(orderDoc.unified.payment.price, state.purchase.price, 'The price paid should survive the refund');
        assert.equal(orderDoc.resourceId, state.purchase.resourceId, 'The order should still point at the checkout resource, not the charge');
        assert.equal(orderDoc.unified.payment.resourceId, state.purchase.paymentResourceId, 'The unified payment resource should still be the checkout resource');

        // What the refund DOES change: the outcome
        assert.equal(orderDoc.unified.status, 'refunded', 'The purchase should now read as refunded');
        assert.equal(parseFloat(orderDoc.unified.payment.refund.amount), state.price, 'The refunded amount should be recorded on the order');
        assert.equal(orderDoc.unified.payment.refund.currency, 'USD', 'The refunded currency should be recorded');
        assert.ok(orderDoc.unified.payment.refund.date?.timestampUNIX > 0, 'The refund should be dated');

        // The endpoint's own record is untouched by the webhook that followed it
        assert.equal(orderDoc.requests.refund.reason, 'Bought the wrong thing', 'The refund request should still be on the order');
      },
    },

    {
      name: 'subscription-unchanged',
      async run({ firestore, assert, state }) {
        // A one-time refund must NOT modify users/{uid}.subscription
        const userDoc = await firestore.get(`users/${state.uid}`);
        const subAfter = userDoc.subscription || null;

        assert.equal(
          subAfter?.product?.id,
          state.subscriptionBefore?.product?.id,
          'Subscription product should be unchanged after a one-time refund',
        );
        assert.equal(
          subAfter?.status,
          state.subscriptionBefore?.status,
          'Subscription status should be unchanged after a one-time refund',
        );
      },
    },
  ],
});
