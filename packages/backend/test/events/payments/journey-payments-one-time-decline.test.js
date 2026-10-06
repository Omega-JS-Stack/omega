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
const { User } = require('../../../dist/omega/helpers/account.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Payment journey: declined one-time checkout → purchase-failed, user untouched',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'declined-checkout-accepted',
      async run({ accounts, firestore, expect, state, config, http, skip }) {
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

        const response = await http.as('journey-payments-one-time').post('omega/payments/intent', {
          provider: 'test',
          productId: oneTimeProduct.id,
          simulate: 'decline',
        });

        expect(response, 'Intent should succeed — the checkout starts, the payment is what fails').toBeSuccess();
        state.orderId = response.data.orderId;
      },
    },

    {
      name: 'purchase-failed-transition-detected',
      async run({ firestore, expect, state, waitFor }) {
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

        expect(webhookDoc.status, 'Failed-invoice webhook should process cleanly').toBe('completed');
        expect(webhookDoc.event.type, 'A declined one-time checkout fires the failed invoice').toBe('invoice.payment_failed');
        expect(webhookDoc.event.category, 'Category should be one-time').toBe('one-time');
        expect(webhookDoc.event.resourceType, 'Resource type should be invoice').toBe('invoice');
        expect(webhookDoc.transition, 'Transition should be purchase-failed').toBe('purchase-failed');
      },
    },

    {
      name: 'order-doc-records-the-failed-purchase',
      async run({ firestore, expect, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc, 'Order doc should exist').toBeTruthy();
        expect(orderDoc.type, 'Type should be one-time').toBe('one-time');
        expect(orderDoc.owner, 'Owner should match').toBe(state.uid);
        expect(orderDoc.provider, 'Provider should be test').toBe('test');
        expect(orderDoc.productId, 'Order should name the attempted product').toBe(state.productId);
        expect(orderDoc.unified.status, 'The purchase must not read as completed').not.toBe('completed');
      },
    },

    {
      name: 'intent-doc-reflects-webhook-outcome',
      async run({ firestore, expect, state }) {
        const intentDoc = await firestore.get(`payments-intents/${state.orderId}`);

        expect(intentDoc, 'Intent doc should exist').toBeTruthy();
        expect(intentDoc.type, 'Type should be one-time').toBe('one-time');

        // 'completed' means the PIPELINE completed, not that the payment succeeded —
        // the intent sync is outcome-blind today ([#212]).
        expect(intentDoc.status, 'Intent status tracks webhook processing, not payment outcome').toBe('completed');
        expect(intentDoc.simulate, 'simulate is request-only — never persisted').toBe(undefined);
      },
    },

    {
      name: 'user-untouched',
      async run({ firestore, expect, state }) {
        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription, 'A one-time decline must leave subscription state exactly as it was').toEqual(state.subscriptionBefore);

        const resolved = new User(userDoc);
        expect(resolved.active, 'The account keeps its (free) access level').toBe(false);
      },
    },
  ],
});
