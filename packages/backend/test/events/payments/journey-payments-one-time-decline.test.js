/**
 * Test: Payment Journey - Declined Checkout (one-time)
 * Simulates: POST /payments/intent { simulate: 'decline' } on a one-time product
 *            → invoice.payment_failed (billing_reason: manual) → purchase-failed
 *
 * Unlike journey-payments-one-time-failure (which posts the failed invoice straight
 * to the webhook route), this journey reaches the decline THROUGH checkout.
 *
 * A one-time decline touches NO subscription state: the only residue is the failed
 * purchase's own order + intent docs.
 *
 * Uses the journey-payments-one-time account (one-time events don't modify
 * subscription state, so the one-time journeys share it).
 */
const User = require('../../../src/manager/helpers/user.js');

module.exports = {
  description: 'Payment journey: declined one-time checkout → purchase-failed, user untouched',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'declined-checkout-accepted',
      async run({ accounts, firestore, assert, state, config, http, skip }) {
        const uid = accounts['journey-payments-one-time'].uid;

        // Resolve first one-time product from config. If none configured, skip the
        // entire journey — this is a config-gap, not a code failure.
        const oneTimeProduct = config.payment.products.find(p => p.type === 'one-time' && p.prices?.once);
        if (!oneTimeProduct) {
          skip('No one-time product configured in this brand');
        }

        state.uid = uid;
        state.productId = oneTimeProduct.id;

        // Snapshot the subscription so the "untouched" assertion compares against
        // whatever this shared account looked like going in
        const before = await firestore.get(`users/${uid}`);
        state.subscriptionBefore = before?.subscription || null;

        const response = await http.as('journey-payments-one-time').post('backend-manager/payments/intent', {
          processor: 'test',
          productId: oneTimeProduct.id,
          simulate: 'decline',
        });

        assert.isSuccess(response, 'Intent should succeed — the checkout starts, the payment is what fails');
        state.orderId = response.data.orderId;
      },
    },

    {
      name: 'purchase-failed-transition-detected',
      async run({ firestore, assert, state, waitFor }) {
        const snapshot = await waitFor(async () => {
          const query = await firestore.collection('payments-webhooks')
            .where('orderId', '==', state.orderId)
            .limit(1)
            .get();

          if (query.empty) {
            return null;
          }

          const status = query.docs[0].data().status;
          return (status === 'completed' || status === 'failed') ? query : null;
        }, 20000, 500);

        const webhookDoc = snapshot.docs[0].data();

        assert.equal(webhookDoc.status, 'completed', 'Failed-invoice webhook should process cleanly');
        assert.equal(webhookDoc.event.type, 'invoice.payment_failed', 'A declined one-time checkout fires the failed invoice');
        assert.equal(webhookDoc.event.category, 'one-time', 'Category should be one-time');
        assert.equal(webhookDoc.event.resourceType, 'invoice', 'Resource type should be invoice');
        assert.equal(webhookDoc.transition, 'purchase-failed', 'Transition should be purchase-failed');
      },
    },

    {
      name: 'order-doc-records-the-failed-purchase',
      async run({ firestore, assert, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        assert.ok(orderDoc, 'Order doc should exist');
        assert.equal(orderDoc.type, 'one-time', 'Type should be one-time');
        assert.equal(orderDoc.owner, state.uid, 'Owner should match');
        assert.equal(orderDoc.processor, 'test', 'Processor should be test');
        assert.equal(orderDoc.productId, state.productId, 'Order should name the attempted product');
        assert.notEqual(orderDoc.unified.status, 'completed', 'The purchase must not read as completed');
      },
    },

    {
      name: 'intent-doc-reflects-webhook-outcome',
      async run({ firestore, assert, state }) {
        const intentDoc = await firestore.get(`payments-intents/${state.orderId}`);

        assert.ok(intentDoc, 'Intent doc should exist');
        assert.equal(intentDoc.type, 'one-time', 'Type should be one-time');

        // 'completed' means the PIPELINE completed, not that the payment succeeded —
        // the intent sync is outcome-blind today ([#212]).
        assert.equal(intentDoc.status, 'completed', 'Intent status tracks webhook processing, not payment outcome');
        assert.equal(intentDoc.simulate, undefined, 'simulate is request-only — never persisted');
      },
    },

    {
      name: 'user-untouched',
      async run({ firestore, assert, state }) {
        const userDoc = await firestore.get(`users/${state.uid}`);

        assert.deepEqual(
          userDoc.subscription,
          state.subscriptionBefore,
          'A one-time decline must leave subscription state exactly as it was',
        );

        const resolved = User.resolveSubscription(userDoc);
        assert.equal(resolved.active, false, 'The account keeps its (free) access level');
      },
    },
  ],
};
