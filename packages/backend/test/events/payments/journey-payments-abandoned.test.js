/**
 * Test: Payment Journey — abandoned checkout leaves no account residue
 *
 * The most common checkout outcome is that nothing happens: a session is created,
 * the customer closes the tab, and the provider never sends an event because none
 * occurred. Every OTHER payment test drives an event through the pipeline, so the
 * one state nothing covered was the state where the pipeline never runs at all
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * What it must leave behind is exactly one thing — the pending intent, which is
 * what the abandoned-cart lane and any later reconciliation read. What it must NOT
 * leave behind is anything that looks like a purchase: no order, no subscription
 * change, no product, no name auto-filled off a payment resource, no claimed
 * trial. A customer who considered buying and did not is indistinguishable from
 * one who never opened the page.
 *
 * `simulate: 'abandon'` is the test provider's shape for it — the session comes
 * back and no webhook is fired. Real providers drop `simulate` at their
 * destructuring boundary, the same way they drop `'decline'`.
 *
 * Run: npx omega test backend:events/payments/journey-payments-abandoned
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
const PERSONA = 'journey-payments-abandoned';

module.exports = defineCases({
  description: 'Payment journey: an abandoned checkout leaves a pending intent and nothing else',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'the-checkout-opens',
      async run({ accounts, firestore, expect, state, config, http, skip, payments }) {
        const paidProduct = config.payment.products.find(p => p.id !== 'basic' && p.prices);

        if (!paidProduct) {
          skip('No paid product configured in this brand');
        }

        state.uid = accounts[PERSONA].uid;
        state.paidProductId = paidProduct.id;
        state.product = payments.products[paidProduct.id];

        // What the account looked like before anyone opened a checkout
        state.before = await firestore.get(`users/${state.uid}`);

        expect(state.before.subscription.product.id, 'The persona starts on basic').toBe('basic');

        const response = await http.as(PERSONA).post('omega/payments/intent', {
          provider: 'test',
          productId: paidProduct.id,
          frequency: state.product.frequency,
          simulate: 'abandon',
        });

        expect(response, 'An abandoned checkout still opens — the session is created either way').toBeSuccess();
        expect(response.data.orderId, 'And it is issued an order id to be reconciled by').toBeTruthy();

        state.orderId = response.data.orderId;
      },
    },

    {
      name: 'the-intent-is-the-only-thing-left-behind',
      async run({ firestore, expect, state }) {
        // Long enough that a webhook fired by mistake would have landed: the whole
        // point is that the pipeline never ran, and an immediate read could not
        // tell that apart from a slow one.
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const intent = await firestore.get(`payments-intents/${state.orderId}`);

        expect(intent, 'The intent doc is written — it is what the abandoned-cart lane reconciles from').toBeTruthy();
        expect(intent.status, 'And it stays pending: nothing completed it').toBe('pending');
        expect(intent.metadata?.completed, 'Nothing stamped it completed either — that slot is opened by the pipeline, which never ran').toBe(undefined);
        expect(intent.owner, 'It knows whose checkout it was').toBe(state.uid);
        expect(intent.simulate, 'The simulation flag is request-only and never persisted').toBe(undefined);
      },
    },

    {
      name: 'no-order-was-minted',
      async run({ firestore, expect, state }) {
        const order = await firestore.get(`payments-orders/${state.orderId}`);

        expect(order, 'An order is a record of a purchase — an abandoned checkout made none').toBe(null);
      },
    },

    {
      name: 'the-account-is-exactly-as-it-was',
      async run({ firestore, expect, state }) {
        const after = await firestore.get(`users/${state.uid}`);

        expect(after.subscription.product.id, 'The customer is still on basic').toBe('basic');
        expect(after.subscription.status, 'Their status is untouched').toBe(state.before.subscription.status);
        expect(after.subscription.payment?.resourceId, 'No subscription resource was attached to them').toBe(state.before.subscription.payment?.resourceId);
        expect(!after.subscription.trial?.claimed, 'And no trial was claimed by opening a checkout').toBeTruthy();

        expect(after.roles, 'No role changed').toEqual(state.before.roles);
        expect(after.personal?.name?.first, 'No name was auto-filled — that happens off a payment resource, and there was no payment').toBe(state.before.personal?.name?.first);
      },
    },

    {
      name: 'no-webhook-was-ever-recorded-for-this-order',
      async run({ firestore, expect, state }) {
        // One equality filter and a JS narrow, deliberately: a second `where` would
        // need a composite index this query has no business asking a brand to deploy.
        const snapshot = await firestore.collection('payments-webhooks')
          .where('owner', '==', state.uid)
          .get();

        const forThisOrder = snapshot.docs.map(d => d.data()).filter(d => d.orderId === state.orderId);

        expect(forThisOrder.length, `An abandoned checkout produces no provider event at all, found ${forThisOrder.length}`).toBe(0);
      },
    },
  ],
});
