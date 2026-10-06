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

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const PERSONA = 'journey-payments-dispute';

// The card the test dispute provider issues against, and the card an alert has to
// name to match anything at all
const CARD = '4242';

module.exports = defineCases({
  description: 'Payment journey: chargeback alert → refund + forced cancel via the test dispute provider',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'setup-paid-subscription',
      async run({ accounts, firestore, expect, state, config, http, waitFor, skip, payments }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);

        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        state.uid = accounts[PERSONA].uid;
        state.email = accounts[PERSONA].email;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];

        const response = await http.as(PERSONA).post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: state.product.frequency,
        });

        expect(response, 'Intent should succeed').toBeSuccess();
        state.orderId = response.data.orderId;

        await waitFor(async () => {
          const userDoc = await firestore.get(`users/${state.uid}`);
          return userDoc?.subscription?.product?.id === paidProduct.id;
        }, 20000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.status, 'The subscriber starts active').toBe('active');
        expect(userDoc.subscription.product.id, `The subscriber starts on ${paidProduct.id}`).toBe(paidProduct.id);

        state.subscriptionId = userDoc.subscription.payment.resourceId;
        state.price = userDoc.subscription.payment.price;
      },
    },

    {
      name: 'an-alert-that-matches-nothing-is-recorded-as-no-match',
      async run({ http, firestore, expect, state, config, waitFor }) {
        // The branch that must stay reachable: an alert whose amount belongs to no
        // subscriber matches nothing, refunds nothing, and cancels nothing. A
        // dispute pipeline that force-cancelled on a near miss would be worse than
        // one that did nothing.
        const alertId = `_test-dispute-nomatch-${Date.now()}`;

        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${config.webhookKey}`, {
          id: alertId,
          card: `411111111111${CARD}`,
          cardBrand: 'visa',
          amount: Number(state.price) + 123.45,
          transactionDate: new Date().toISOString().split('T')[0],
          processor: 'test',
          customerEmail: state.email,
        });

        expect(response, 'The alert door should accept it').toBeSuccess();

        await waitFor(async () => {
          const doc = await firestore.get(`payments-disputes/${alertId}`);
          return ['no-match', 'resolved', 'failed'].includes(doc?.status) ? doc : null;
        }, 20000, 500);

        const dispute = await firestore.get(`payments-disputes/${alertId}`);

        expect(dispute.status, 'An amount nobody paid must not match a subscriber').toBe('no-match');
        expect(dispute.actions.refund, 'Nothing is refunded on a miss').toBe('skipped');
        expect(dispute.actions.cancel, 'And nothing is cancelled on a miss').toBe('skipped');

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.status, 'The subscriber is untouched by an alert that matched nothing').toBe('active');
        expect(userDoc.subscription.product.id, 'And keeps their plan').toBe(state.paidProductId);
      },
    },

    {
      name: 'the-real-alert-matches-the-charge',
      async run({ http, firestore, expect, state, config, waitFor }) {
        state.alertId = `_test-dispute-${Date.now()}`;

        const response = await http.as('none').post(`omega/payments/dispute-alert?key=${config.webhookKey}`, {
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

        expect(response, 'The alert door should accept it').toBeSuccess();

        await waitFor(async () => {
          const doc = await firestore.get(`payments-disputes/${state.alertId}`);
          return ['resolved', 'no-match', 'failed'].includes(doc?.status) ? doc : null;
        }, 20000, 500);

        const dispute = await firestore.get(`payments-disputes/${state.alertId}`);

        expect(dispute.status, `The dispute should resolve, got ${dispute.status}: ${dispute.error || 'no error'}`).toBe('resolved');
        expect(dispute.match.uid, 'It matched the right subscriber').toBe(state.uid);
        expect(dispute.match.subscriptionId, 'And their live subscription').toBe(state.subscriptionId);
        expect(dispute.actions.refund, 'The disputed charge is refunded').toBe('success');
        expect(dispute.actions.cancel, 'And the subscription is cancelled').toBe('success');
        expect(dispute.errors, 'With nothing left over').toEqual([]);
      },
    },

    {
      name: 'the-cancel-goes-through-the-webhook-pipeline',
      async run({ firestore, expect, state, waitFor }) {
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

        expect(webhook.transition, 'The forced cancel lands on the cancellation transition, like any other').toBe('subscription-cancelled');
        expect(webhook.provider, 'It came through the pipeline as a provider event').toBe('test');
      },
    },

    {
      name: 'the-subscriber-loses-access',
      async run({ firestore, expect, state, waitFor }) {
        await waitFor(async () => {
          const doc = await firestore.get(`users/${state.uid}`);
          return doc?.subscription?.status === 'cancelled';
        }, 20000, 500);

        const userDoc = await firestore.get(`users/${state.uid}`);

        expect(userDoc.subscription.status, 'A chargeback ends the subscription outright — no term to serve out').toBe('cancelled');
        expect(userDoc.subscription.cancellation.pending, 'Nothing is left pending: the cancel already happened').toBe(false);

        const orderDoc = await firestore.get(`payments-orders/${state.orderId}`);

        expect(orderDoc.unified.status, 'The order mirrors it').toBe('cancelled');
      },
    },
  ],
});
