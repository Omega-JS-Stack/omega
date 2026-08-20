/**
 * Test: Payment Journey - Declined win-back
 * Simulates: fully cancelled paid subscriber → checkout with simulate: 'decline'
 *            → suspended
 *
 * One branch past #218's win-back gap: a full cancellation leaves the PAID product
 * id on the user doc, so a returning subscriber whose payment DECLINES arrives as
 * cancelled paid → suspended — which matched none of the nine transition rules.
 * The webhook completed silently: no transition, no log, no analytics
 * ([#223](https://github.com/Omega-JS-Stack/omega/issues/223)).
 *
 * The caller is built by the shared route harness rather than a persona: the
 * starting state (a cancelled subscription) is a SHAPE. Everything downstream of
 * the handler — the test processor's declined checkout, both webhook docs, the
 * on-write trigger, the transition detection, the user-doc write — is the real
 * pipeline.
 *
 * Product-agnostic: resolves the first paid product from config.payment.products
 *
 * Run: npx omega test framework:events/payments/journey-payments-winback-decline
 */
const { buildUser, callHandler } = require('../../routes/payments/_route-harness.js');

const handler = require('../../../src/manager/routes/payments/intent/post.js');

const UID = '_test-journey-payments-winback-decline';
const RESOURCE_ID = 'sub_test_journey_winback_decline_cancelled';

module.exports = {
  description: 'Payment journey: cancelled subscriber resubscribes and is declined → checkout-declined',
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
      name: 'resubscribe-through-a-declining-checkout',
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
          settings: {
            processor: 'test',
            productId: state.productId,
            frequency: state.frequency,
            trial: false,
            verification: {},
            attribution: {},
            trackingConsent: null,
            discount: null,
            supplemental: {},
            simulate: 'decline',
          },
        });

        assert.equal(sent.code, 200, `The checkout starts — the payment is what fails, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.ok(sent.body?.orderId, `Checkout should return an orderId, got ${JSON.stringify(sent.body)}`);

        state.orderId = sent.body.orderId;
      },
    },

    {
      name: 'the-declined-win-back-suspends-the-subscriber',
      async run({ firestore, assert, state, waitFor }) {
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.status === 'suspended';
        }, 20000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        assert.equal(userDoc.subscription.status, 'suspended', 'Status should be suspended after the declined win-back');
        assert.equal(userDoc.subscription.product.id, state.productId, 'Product should be the ATTEMPTED product');
        assert.equal(userDoc.subscription.payment.orderId, state.orderId, 'Order ID should match the intent');
      },
    },

    {
      name: 'checkout-declined-transition-detected',
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

        assert.equal(webhookDoc.status, 'completed', 'The declined win-back webhook should process cleanly');
        assert.equal(webhookDoc.transition, 'checkout-declined', 'Transition should be checkout-declined — the user is at the checkout watching it fail, not a subscriber being dunned');
      },
    },
  ],
};
