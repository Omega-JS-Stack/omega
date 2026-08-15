/**
 * Test: Payment Journey - Win-back
 * Simulates: fully cancelled paid subscriber → checkout → active again
 *
 * A full cancellation leaves the PAID product id on the user doc (status goes to
 * cancelled, the product does not go back to basic), so the returning subscriber's
 * checkout matched none of the transition rules: no confirmation email, and the
 * analytics resolver read the payment event as a renewal
 * ([#218](https://github.com/Omega-JS-Stack/omega/issues/218)).
 *
 * The caller is built by the shared route harness rather than a persona: the
 * starting state (a cancelled subscription) is a SHAPE, and the harness lets one
 * test choose a shape without minting a persona for it. Everything downstream of
 * the handler — the test processor's checkout, the webhook doc, the on-write
 * trigger, the transition detection, the user-doc write — is the real pipeline.
 *
 * Product-agnostic: resolves the first paid product from config.payment.products
 *
 * Run: npx omega test framework:events/payments/journey-payments-winback
 */
const { buildUser, callHandler } = require('../../routes/payments/_route-harness.js');
const analytics = require('../../../src/manager/events/firestore/payments-webhooks/analytics.js');

const handler = require('../../../src/manager/routes/payments/intent/post.js');

const UID = '_test-journey-payments-winback';
const RESOURCE_ID = 'sub_test_journey_winback_cancelled';

module.exports = {
  description: 'Payment journey: cancelled subscriber resubscribes → win-back',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'setup-cancelled-subscriber',
      async run({ firestore, assert, state, config, skip }) {
        const paidProduct = (config.payment?.products || []).find((p) => p.id !== 'basic' && p.type === 'subscription' && p.prices);

        if (!paidProduct) {
          skip('No paid subscription product configured in this brand');
        }

        const frequency = Object.keys(paidProduct.prices)[0];
        const nowUNIX = Math.floor(Date.now() / 1000);
        const cancelledUNIX = nowUNIX - (7 * 86400);
        const startUNIX = nowUNIX - (365 * 86400);

        state.uid = UID;
        state.productId = paidProduct.id;
        state.frequency = frequency;

        // The starting state: cancelled outright a week ago, still carrying the paid
        // product id — what subscription-cancelled leaves behind.
        state.subscription = {
          product: { id: paidProduct.id, name: paidProduct.name || paidProduct.id },
          status: 'cancelled',
          expires: { timestamp: new Date(cancelledUNIX * 1000).toISOString(), timestampUNIX: cancelledUNIX },
          trial: { claimed: false },
          cancellation: {
            pending: false,
            date: { timestamp: new Date(cancelledUNIX * 1000).toISOString(), timestampUNIX: cancelledUNIX },
          },
          payment: {
            processor: 'test',
            orderId: null,
            resourceId: RESOURCE_ID,
            frequency: frequency,
            price: paidProduct.prices[frequency],
            startDate: { timestamp: new Date(startUNIX * 1000).toISOString(), timestampUNIX: startUNIX },
          },
        };

        // The pipeline reads users/{uid} for its BEFORE state, so the doc has to be
        // the real record the transition is detected against.
        await firestore.set(`users/${UID}`, {
          auth: { uid: UID, email: `${UID}@example.com` },
          roles: {},
          subscription: state.subscription,
        }, { merge: true });

        const userDoc = await firestore.get(`users/${UID}`);
        assert.equal(userDoc.subscription.status, 'cancelled', 'Should start cancelled');
        assert.equal(userDoc.subscription.product.id, state.productId, 'Should still carry the paid product id');
      },
    },

    {
      name: 'resubscribe-through-checkout',
      async run({ assert, Manager, state }) {
        const user = buildUser(Manager, {
          auth: { uid: UID, email: `${UID}@example.com` },
          roles: {},
          subscription: state.subscription,
        });

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-intent',
          user,
          // What schemas/payments/intent/post.js resolves a bare checkout request
          // to — the handler receives settings already defaulted, and writes them
          // onto the intent doc as-is.
          settings: {
            processor: 'test',
            productId: state.productId,
            frequency: state.frequency,
            trial: false,
            verification: {},
            attribution: {},
            discount: null,
            supplemental: {},
            simulate: null,
          },
        });

        assert.equal(sent.code, 200, `A cancelled subscriber should be allowed to check out again, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.ok(sent.body?.orderId, `Checkout should return an orderId, got ${JSON.stringify(sent.body)}`);

        state.orderId = sent.body.orderId;
      },
    },

    {
      name: 'subscription-is-active-again',
      async run({ firestore, assert, state, waitFor }) {
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.status === 'active';
        }, 20000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);
        assert.equal(userDoc.subscription.status, 'active', 'Status should be active again');
        assert.equal(userDoc.subscription.product.id, state.productId, `Product should be ${state.productId}`);
        assert.equal(userDoc.subscription.cancellation.pending, false, 'The new subscription should carry no pending cancellation');
      },
    },

    {
      name: 'win-back-transition-detected',
      async run({ firestore, assert, state, waitFor }) {
        const snapshot = await waitFor(async () => {
          const query = await firestore.collection('payments-webhooks')
            .where('owner', '==', state.uid)
            .where('event.type', '==', 'customer.subscription.created')
            .limit(1)
            .get();

          if (query.empty) {
            return null;
          }

          const status = query.docs[0].data().status;
          return (status === 'completed' || status === 'failed') ? query : null;
        }, 30000, 500);

        const webhookDoc = snapshot.docs[0].data();

        assert.equal(webhookDoc.status, 'completed', 'The win-back webhook should process cleanly');
        assert.equal(webhookDoc.transition, 'subscription-winback', 'Transition should be subscription-winback');

        state.eventType = webhookDoc.event.type;
        state.transition = webhookDoc.transition;
      },
    },

    {
      name: 'win-back-tracks-as-a-purchase',
      async run({ firestore, assert, state }) {
        // The order doc the pipeline just wrote IS what trackPayment resolved its
        // event from — run the resolver over it to prove the win-back reports a
        // purchase and not the renewal it used to report.
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        assert.ok(orderDoc, 'Order doc should exist');
        assert.equal(orderDoc.owner, state.uid, 'Owner should match');

        const resolved = analytics.resolvePaymentEvent('subscription', state.transition, state.eventType, orderDoc.unified, orderDoc);

        assert.ok(resolved, 'A win-back should resolve to a trackable analytics event');
        assert.equal(resolved.reason, 'winback-purchase', 'Reason should be winback-purchase');
        assert.equal(resolved.isRecurring, false, 'A win-back is a purchase, not recurring revenue');
        assert.equal(resolved.productId, state.productId, 'The tracked product should be the resubscribed product');
      },
    },
  ],
};
