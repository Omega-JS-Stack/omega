/**
 * Test: Payment Journey - Declined Checkout (subscription)
 * Simulates: basic → POST /payments/intent { simulate: 'decline' } → suspended
 *            → payment recovers → active
 *
 * Unlike journey-payments-failure (which posts invoice.payment_failed straight to
 * the webhook route on an already-paid subscription), this journey reaches the
 * decline THROUGH checkout: the test provider fires the subscription in a dunning
 * state plus its failed first invoice, exactly as a real provider would.
 *
 * Suspended is the dunning ENTRY state, not an access state — the user holds the
 * attempted product but resolves to no access until the payment recovers.
 *
 * Product-agnostic: resolves the first paid subscription product from config.
 */
const User = require('../../../src/manager/helpers/user.js');

module.exports = {
  description: 'Payment journey: declined checkout → suspended (no access) → recovered',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'declined-checkout-suspends-user',
      async run({ accounts, firestore, assert, state, config, http, waitFor, skip, payments }) {
        const uid = accounts['journey-payments-decline'].uid;

        // Resolve first paid subscription product. If the brand has none configured,
        // skip the entire journey — this is a config-gap, not a code failure.
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.type === 'subscription' && p.prices);
        if (!paidProduct) {
          skip('No paid subscription product configured in this brand');
        }

        state.uid = uid;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];

        const response = await http.as('journey-payments-decline').post('backend-manager/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: state.product.frequency,
          simulate: 'decline',
        });

        assert.isSuccess(response, 'Intent should succeed — the checkout starts, the payment is what fails');
        state.orderId = response.data.orderId;

        // Wait for the declined subscription to land on the user
        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${uid}`);
          return userDoc?.subscription?.status === 'suspended';
        }, 20000, 500);

        const userDoc = await firestore.get(`users/${uid}`);
        assert.equal(userDoc.subscription.status, 'suspended', 'Status should be suspended after a declined checkout');
        assert.equal(userDoc.subscription.product.id, paidProduct.id, 'Product should be the ATTEMPTED product');
        assert.equal(userDoc.subscription.payment.orderId, state.orderId, 'Order ID should match the intent');

        state.subscriptionId = userDoc.subscription.payment.resourceId;
      },
    },

    {
      name: 'suspended-grants-no-access',
      async run({ firestore, assert, state }) {
        const userDoc = await firestore.get(`users/${state.uid}`);
        const resolved = User.resolveSubscription(userDoc);

        assert.equal(resolved.active, false, 'Suspended should grant no access');
        assert.equal(resolved.plan, 'basic', 'Effective plan should fall back to basic');
        assert.equal(resolved.trialing, false, 'A declined checkout should claim no trial');
      },
    },

    {
      name: 'checkout-declined-transition-detected',
      async run({ firestore, assert, state, waitFor }) {
        // A user doc carries subscription.status 'active' on 'basic' from birth, so a
        // FIRST-checkout decline used to read as active → suspended and send the
        // renewal-dunning email to someone who never had a subscription. The
        // basic-before rule sits in front of payment-failed and names this case for
        // what it is: a checkout the user is watching fail ([#212]).
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

        assert.equal(webhookDoc.status, 'completed', 'Subscription webhook should process cleanly');
        assert.equal(webhookDoc.transition, 'checkout-declined', 'Transition should be checkout-declined, not the renewal-dunning payment-failed');
      },
    },

    {
      name: 'failed-invoice-webhook-recorded',
      async run({ firestore, assert, state, waitFor }) {
        // The declined checkout fires TWO events: the dunning subscription, then its
        // failed first invoice (billing_reason: subscription_create)
        const snapshot = await waitFor(async () => {
          const query = await firestore.collection('payments-webhooks')
            .where('owner', '==', state.uid)
            .where('event.type', '==', 'invoice.payment_failed')
            .limit(1)
            .get();

          if (query.empty) {
            return null;
          }

          const status = query.docs[0].data().status;
          return (status === 'completed' || status === 'failed') ? query : null;
        }, 30000, 500);

        const webhookDoc = snapshot.docs[0].data();

        assert.equal(webhookDoc.status, 'completed', 'Failed-invoice webhook should process cleanly');
        assert.equal(webhookDoc.event.category, 'subscription', 'Category should be subscription');
        assert.equal(webhookDoc.event.resourceId, state.subscriptionId, 'Resource ID should be the subscription');
        assert.equal(webhookDoc.orderId, state.orderId, 'Webhook should resolve to the checkout order');

        // The subscription event already suspended the user, so the invoice event is
        // suspended → suspended: no second transition, no duplicate dunning email.
        assert.equal(webhookDoc.transition, null, 'The failed invoice should not re-fire the dunning transition');
      },
    },

    {
      name: 'order-doc-holds-the-attempted-product',
      async run({ firestore, assert, state }) {
        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        assert.ok(orderDoc, 'Order doc should exist');
        assert.equal(orderDoc.type, 'subscription', 'Type should be subscription');
        assert.equal(orderDoc.owner, state.uid, 'Owner should match');
        assert.equal(orderDoc.productId, state.paidProductId, 'Order should name the attempted product');
        assert.equal(orderDoc.unified.status, 'suspended', 'Unified status should be suspended');
      },
    },

    {
      name: 'intent-doc-reflects-webhook-outcome',
      async run({ firestore, assert, state }) {
        const intentDoc = await firestore.get(`payments-intents/${state.orderId}`);

        assert.ok(intentDoc, 'Intent doc should exist');
        assert.equal(intentDoc.id, state.orderId, 'ID should match orderId');

        // 'completed' means the PIPELINE completed, not that the payment succeeded —
        // the intent sync is outcome-blind today. A decline that ends 'failed' needs
        // the pipeline's intent sync to read the payment outcome ([#212]).
        assert.equal(intentDoc.status, 'completed', 'Intent status tracks webhook processing, not payment outcome');
        assert.ok(intentDoc.metadata?.completed?.timestampUNIX > 0, 'Completed timestamp should be set');
        assert.equal(intentDoc.simulate, undefined, 'simulate is request-only — never persisted');
      },
    },

    {
      name: 'send-recovery-webhook',
      async run({ http, assert, state, config, payments }) {
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + 1);

        state.recoveryEventId = `_test-evt-journey-decline-recover-${Date.now()}`;

        const response = await http.as('none').post(`backend-manager/payments/webhook?provider=test&key=${config.webhookKey}`, {
          id: state.recoveryEventId,
          type: 'customer.subscription.updated',
          data: {
            object: {
              id: state.subscriptionId,
              object: 'subscription',
              status: 'active',
              metadata: { uid: state.uid, orderId: state.orderId },
              cancel_at_period_end: false,
              canceled_at: null,
              current_period_end: Math.floor(futureDate.getTime() / 1000),
              current_period_start: Math.floor(Date.now() / 1000),
              start_date: Math.floor(Date.now() / 1000),
              trial_start: null,
              trial_end: null,
              plan: { product: payments.stripeProductIds[state.paidProductId], interval: state.product.interval },
            },
          },
        });

        assert.isSuccess(response, 'Recovery webhook should be accepted');
      },
    },

    {
      name: 'recovered-subscription-grants-access',
      async run({ firestore, assert, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`payments-webhooks/${state.recoveryEventId}`);
          return doc?.status === 'completed';
        }, 20000, 500);

        const webhookDoc = await firestore.get(`payments-webhooks/${state.recoveryEventId}`);
        assert.equal(webhookDoc.transition, 'payment-recovered', 'Transition should be payment-recovered');

        const userDoc = await firestore.get(`users/${state.uid}`);
        assert.equal(userDoc.subscription.status, 'active', 'Status should be active after recovery');
        assert.equal(userDoc.subscription.product.id, state.paidProductId, `Product should still be ${state.paidProductId}`);

        const resolved = User.resolveSubscription(userDoc);
        assert.equal(resolved.active, true, 'Recovered subscription should grant access');
        assert.equal(resolved.plan, state.paidProductId, 'Effective plan should be the paid product');
      },
    },
  ],
};
