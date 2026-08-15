/**
 * Test: Payment Journey - Plan switch via endpoint
 * Simulates: paid product A → POST /payments/plan → plan-changed → paid product B
 *
 * The twin of journey-payments-plan-change.test.js, driven by the OWNED route
 * instead of a hand-sent webhook: the test processor's switchPlan() writes a
 * Stripe-shaped `customer.subscription.updated` carrying the NEW product, and the
 * existing plan-changed transition fires naturally — the route needs no pipeline
 * work of its own.
 *
 * The caller is built by the shared route harness rather than a persona (see
 * journey-payments-uncancel.test.js for the reasoning); everything downstream of
 * the handler is the real pipeline.
 *
 * Requires at least two paid subscription products in config.
 *
 * Run: npx omega test framework:events/payments/journey-payments-plan-switch
 */
const { buildUser, callHandler } = require('../../routes/payments/_route-harness.js');

const handler = require('../../../src/manager/routes/payments/plan/post.js');

const UID = '_test-journey-payments-plan-switch';
const RESOURCE_ID = 'sub_test_journey_plan_switch';
const ORDER_ID = 'TEST-PLAN-SWTCH';

module.exports = {
  description: 'Payment journey: plan endpoint → plan-changed → paid product B',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'setup-paid-subscription',
      async run({ firestore, assert, state, config, skip }) {
        const paidProducts = (config.payment?.products || []).filter((p) => p.id !== 'basic' && p.type === 'subscription' && p.prices);

        if (paidProducts.length < 2) {
          skip('Fewer than two paid subscription products configured in this brand');
        }

        const productA = paidProducts[0];
        const productB = paidProducts[1];
        const frequencyA = Object.keys(productA.prices)[0];
        const frequencyB = Object.keys(productB.prices)[0];

        const nowUNIX = Math.floor(Date.now() / 1000);
        const periodEndUNIX = nowUNIX + (30 * 86400);
        const startUNIX = nowUNIX - (365 * 86400);

        state.uid = UID;
        state.productA = { id: productA.id, name: productA.name || productA.id, frequency: frequencyA };
        state.productB = { id: productB.id, name: productB.name || productB.id, frequency: frequencyB };

        state.subscription = {
          product: { id: productA.id, name: state.productA.name },
          status: 'active',
          expires: { timestamp: new Date(periodEndUNIX * 1000).toISOString(), timestampUNIX: periodEndUNIX },
          trial: { claimed: false },
          cancellation: { pending: false },
          payment: {
            processor: 'test',
            orderId: ORDER_ID,
            resourceId: RESOURCE_ID,
            frequency: frequencyA,
            price: productA.prices[frequencyA],
            startDate: { timestamp: new Date(startUNIX * 1000).toISOString(), timestampUNIX: startUNIX },
          },
        };

        // The pipeline reads users/{uid} for its BEFORE state — plan-changed is
        // detected by comparing that product against the incoming one.
        await firestore.set(`users/${UID}`, {
          auth: { uid: UID, email: `${UID}@example.com` },
          roles: {},
          subscription: state.subscription,
        }, { merge: true });

        // The order the checkout would have written, so the switch's effect on it
        // is observable the way journey-payments-plan-change.test.js observes it.
        await firestore.set(`payments-orders/${ORDER_ID}`, {
          id: ORDER_ID,
          type: 'subscription',
          owner: UID,
          productId: productA.id,
          processor: 'test',
          resourceId: RESOURCE_ID,
          unified: state.subscription,
          requests: { cancellation: null, refund: null },
        }, { merge: true });

        const userDoc = await firestore.get(`users/${UID}`);
        assert.equal(userDoc.subscription.product.id, productA.id, `Should start as ${productA.id}`);
        assert.equal(userDoc.subscription.status, 'active', 'Should be active');
      },
    },

    {
      name: 'call-plan-endpoint',
      async run({ assert, Manager, state }) {
        const user = buildUser(Manager, {
          auth: { uid: UID, email: `${UID}@example.com` },
          roles: {},
          subscription: state.subscription,
        });

        const sent = await callHandler({
          Manager,
          handler,
          functionName: 'payments-plan',
          user,
          settings: {
            productId: state.productB.id,
            frequency: state.productB.frequency,
            confirmed: true,
          },
        });

        assert.equal(sent.code, 200, `Plan switch should succeed, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.equal(sent.body?.success, true, `Should return { success: true }, got ${JSON.stringify(sent.body)}`);
      },
    },

    {
      name: 'plan-changed-transition-detected',
      async run({ firestore, assert, waitFor }) {
        const snapshot = await waitFor(async () => {
          const query = await firestore.collection('payments-webhooks')
            .where('owner', '==', UID)
            .where('status', '==', 'completed')
            .limit(1)
            .get();

          return query.empty ? null : query;
        }, 15000, 500);

        const webhookDoc = snapshot.docs[0].data();
        assert.equal(webhookDoc.transition, 'plan-changed', `Transition should be plan-changed, got ${webhookDoc.transition}`);
      },
    },

    {
      name: 'subscription-updated-to-product-b',
      async run({ firestore, assert, state, waitFor }) {
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.product?.id === state.productB.id;
        }, 15000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);
        assert.equal(userDoc.subscription.product.id, state.productB.id, `Product should be ${state.productB.id}`);
        assert.equal(userDoc.subscription.product.name, state.productB.name, `Product name should be ${state.productB.name}`);
        assert.equal(userDoc.subscription.status, 'active', 'Status should still be active');
        assert.equal(userDoc.subscription.cancellation.pending, false, 'Switching plans must not schedule a cancellation');
        assert.equal(userDoc.subscription.payment.processor, 'test', 'Processor should be test');
        assert.equal(userDoc.subscription.payment.frequency, state.productB.frequency, `Frequency should be ${state.productB.frequency}`);
        assert.equal(userDoc.subscription.payment.resourceId, RESOURCE_ID, 'Resource ID should be the same subscription');
      },
    },

    {
      name: 'order-doc-updated',
      async run({ firestore, assert, state, waitFor }) {
        await waitFor(async () => {
          const orderDoc = await firestore.get(`payments-orders/${ORDER_ID}`);
          return orderDoc?.unified?.product?.id === state.productB.id;
        }, 15000, 500);

        const orderDoc = await firestore.get(`payments-orders/${ORDER_ID}`);
        assert.equal(orderDoc.unified.product.id, state.productB.id, `Order product should be ${state.productB.id}`);
        assert.equal(orderDoc.unified.status, 'active', 'Order status should be active');
        assert.equal(orderDoc.requests.cancellation, null, 'requests.cancellation should still be null');
        assert.equal(orderDoc.requests.refund, null, 'requests.refund should still be null');
      },
    },
  ],
};
