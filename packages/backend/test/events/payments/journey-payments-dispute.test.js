/**
 * Test: Payment Journey — chargeback → forced cancel
 *
 * A dispute is the only payment path that takes access away without the customer
 * asking, and it is the one nothing proved end to end
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)). Both halves of the
 * real chain needed a live Stripe account: `searchAndMatch` needs a real charge,
 * and `processDispute` needs a real refund and a real `subscriptions.cancel()`.
 *
 * So the dispute pipeline gets the same treatment the payment routes already had:
 * a TEST provider (events/firestore/payments-disputes/providers/test.js) that
 * matches against the emulator's own records and issues the cancel by writing the
 * `customer.subscription.deleted` event Stripe's cancel produces. Everything else
 * on the path is the real thing — the alert door, the dispute trigger, the webhook
 * pipeline, the transition table.
 *
 * The chain proven here: alert in → charge matched → refund + cancel issued →
 * subscription webhook processed → subscriber back on basic, no access.
 *
 * Run: npx omega test backend:events/payments/journey-payments-dispute
 */
const PERSONA = 'journey-payments-dispute';

// The card the test dispute provider issues against, and the card an alert has to
// name to match anything at all
const CARD = '4242';

module.exports = {
  description: 'Payment journey: chargeback alert → refund + forced cancel via the test dispute provider',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'setup-paid-subscription',
      async run({ accounts, firestore, assert, state, config, http, waitFor, skip, payments }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);

        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        state.uid = accounts[PERSONA].uid;
        state.email = accounts[PERSONA].email;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];

        const response = await http.as(PERSONA).post('backend-manager/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: state.product.frequency,
        });

        assert.isSuccess(response, 'Intent should succeed');
        state.orderId = response.data.orderId;

        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.product?.id === paidProduct.id;
        }, 20000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        assert.equal(userDoc.subscription.status, 'active', 'The subscriber starts active');
        assert.equal(userDoc.subscription.product.id, paidProduct.id, `The subscriber starts on ${paidProduct.id}`);

        state.subscriptionId = userDoc.subscription.payment.resourceId;
        state.price = userDoc.subscription.payment.price;
      },
    },

    {
      name: 'an-alert-that-matches-nothing-is-recorded-as-no-match',
      async run({ http, firestore, assert, state, config, waitFor }) {
        // The branch that must stay reachable: an alert whose amount belongs to no
        // subscriber matches nothing, refunds nothing, and cancels nothing. A
        // dispute pipeline that force-cancelled on a near miss would be worse than
        // one that did nothing.
        const alertId = `_test-dispute-nomatch-${Date.now()}`;

        const response = await http.as('none').post(`backend-manager/payments/dispute-alert?key=${config.webhookKey}`, {
          id: alertId,
          card: `411111111111${CARD}`,
          cardBrand: 'visa',
          amount: Number(state.price) + 123.45,
          transactionDate: new Date().toISOString().split('T')[0],
          processor: 'test',
          customerEmail: state.email,
        });

        assert.isSuccess(response, 'The alert door should accept it');

        await waitFor(async () => {
          const doc = await firestore.get(`payments-disputes/${alertId}`);
          return ['no-match', 'resolved', 'failed'].includes(doc?.status) ? doc : null;
        }, 20000, 500);

        const dispute = await firestore.get(`payments-disputes/${alertId}`);

        assert.equal(dispute.status, 'no-match', 'An amount nobody paid must not match a subscriber');
        assert.equal(dispute.actions.refund, 'skipped', 'Nothing is refunded on a miss');
        assert.equal(dispute.actions.cancel, 'skipped', 'And nothing is cancelled on a miss');

        const userDoc = await firestore.get(`users/${state.uid}`);

        assert.equal(userDoc.subscription.status, 'active', 'The subscriber is untouched by an alert that matched nothing');
        assert.equal(userDoc.subscription.product.id, state.paidProductId, 'And keeps their plan');
      },
    },

    {
      name: 'the-real-alert-matches-the-charge',
      async run({ http, firestore, assert, state, config, waitFor }) {
        state.alertId = `_test-dispute-${Date.now()}`;

        const response = await http.as('none').post(`backend-manager/payments/dispute-alert?key=${config.webhookKey}`, {
          id: state.alertId,
          card: `411111111111${CARD}`,
          cardBrand: 'visa',
          amount: state.price,
          transactionDate: new Date().toISOString().split('T')[0],
          processor: 'test',
          alertType: 'alert.created',
          customerEmail: state.email,
          reasonCode: 'fraudulent',
        });

        assert.isSuccess(response, 'The alert door should accept it');

        await waitFor(async () => {
          const doc = await firestore.get(`payments-disputes/${state.alertId}`);
          return ['resolved', 'no-match', 'failed'].includes(doc?.status) ? doc : null;
        }, 20000, 500);

        const dispute = await firestore.get(`payments-disputes/${state.alertId}`);

        assert.equal(dispute.status, 'resolved', `The dispute should resolve, got ${dispute.status}: ${dispute.error || 'no error'}`);
        assert.equal(dispute.match.uid, state.uid, 'It matched the right subscriber');
        assert.equal(dispute.match.subscriptionId, state.subscriptionId, 'And their live subscription');
        assert.equal(dispute.actions.refund, 'success', 'The disputed charge is refunded');
        assert.equal(dispute.actions.cancel, 'success', 'And the subscription is cancelled');
        assert.deepEqual(dispute.errors, [], 'With nothing left over');
      },
    },

    {
      name: 'the-cancel-goes-through-the-webhook-pipeline',
      async run({ firestore, assert, state, waitFor }) {
        // The cancel is NOT written onto the user. It is issued as the provider
        // event a real cancel produces, and the pipeline is what revokes access —
        // the same path a customer-initiated cancellation takes.
        // One equality filter and a JS narrow, deliberately: a second `where` would
        // need a composite index this query has no business asking a brand to deploy.
        const webhook = await waitFor(async () => {
          const snapshot = await firestore.collection('payments-webhooks')
            .where('owner', '==', state.uid)
            .get();

          return snapshot.docs
            .map(d => d.data())
            .find(d => d.event?.type === 'customer.subscription.deleted' && d.status === 'completed') || null;
        }, 20000, 500);

        assert.equal(webhook.transition, 'subscription-cancelled', 'The forced cancel lands on the cancellation transition, like any other');
        assert.equal(webhook.provider, 'test', 'It came through the pipeline as a provider event');
      },
    },

    {
      name: 'the-subscriber-loses-access',
      async run({ firestore, assert, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`users/${state.uid}`);
          return doc?.subscription?.status === 'cancelled';
        }, 20000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        assert.equal(userDoc.subscription.status, 'cancelled', 'A chargeback ends the subscription outright — no term to serve out');
        assert.equal(userDoc.subscription.cancellation.pending, false, 'Nothing is left pending: the cancel already happened');

        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        assert.equal(orderDoc.unified.status, 'cancelled', 'The order mirrors it');
      },
    },
  ],
};
