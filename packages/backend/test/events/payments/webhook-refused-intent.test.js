/**
 * Test: a REFUSED event touches no doc the payload named, even when its own stamp fails
 *
 * A refusal writes one thing — the stamp on the event's own doc — and nothing
 * else. But if that write itself throws, the outer failure path took over and ran
 * `resolveOrderIdAfterFailure()`, which reads the orderId out of the PAYLOAD and
 * marks `payments-intents/{orderId}` failed. So the one doc a refused forgery
 * could still reach was a doc named entirely by the caller
 * ([#535](https://github.com/Omega-JS-Stack/omega/issues/535)).
 *
 * The refusal is already the terminal state, so the failure path writes nothing
 * for it: the event doc is marked failed (the retry sweep re-lands the stamp on
 * the next pass) and the payload-derived intent write is skipped entirely.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js). The
 * emulator cannot produce this fault at all — the admin SDK bypasses rules and
 * every write is legal — so the stand-in fails the ONE write this is about: the
 * stamp, identified by the refusal it carries, leaving the failure stamp that
 * follows it on the same doc free to land.
 *
 * Run: npx omega test backend:events/payments/webhook-refused-intent
 */
const assert = require('node:assert');
const { runTrigger, subscriptionPayload } = require('./_webhook-harness.js');
const Stripe = require('../../../src/manager/libraries/payment/providers/stripe.js');

// The subscriber the subscription actually belongs to, on Stripe's own record
const OWNER_UID = '_test-refused-intent-owner';
const OWNER_ORDER_ID = '5351-5351-5351';

// The uid the forged event claims, and the order it names — both the caller's choice
const FORGED_UID = '_test-refused-intent-forged';
const FORGED_ORDER_ID = '5350-5350-5350';

const RESOURCE_ID = 'sub_test_refused_intent';
const EVENT_ID = '_test-refused-intent-evt';

/** Run fn with the library's SDK replaced by one that answers with `subscription` */
async function withStripeAnswering(subscription, fn) {
  const realInit = Stripe.init;

  Stripe.init = () => ({ subscriptions: { retrieve: async () => subscription } });

  try {
    return await fn();
  } finally {
    Stripe.init = realInit;
  }
}

/**
 * The forged event — a real subscription id under someone else's uid, which the
 * #509 check refuses — run with the refusal STAMP as the write that rejects
 */
function runRefusalWhoseStampFails() {
  const record = subscriptionPayload({ uid: OWNER_UID, orderId: OWNER_ORDER_ID, resourceId: RESOURCE_ID });

  return withStripeAnswering(record, () => runTrigger({
    uid: FORGED_UID,
    orderId: FORGED_ORDER_ID,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    provider: 'stripe',
    payload: subscriptionPayload({ uid: FORGED_UID, orderId: FORGED_ORDER_ID, resourceId: RESOURCE_ID }),
    authUids: [OWNER_UID, FORGED_UID],
    // The stamp is the write that fails — the failure stamp that follows it lands
    // on the same doc and must still be able to
    failPath: (path, data) => path === `payments-webhooks/${EVENT_ID}` && !!data.refusal,
  }));
}

module.exports = {
  description: 'A refused event whose refusal stamp fails to write still touches nothing else',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'no intent doc is written for the order the payload named',

      async run() {
        const { store } = await runRefusalWhoseStampFails();

        assert.ok(!store.get(`payments-intents/${FORGED_ORDER_ID}`), 'the refused event must not reach a doc named by the caller, not even to fail it');
        assert.ok(!store.get(`payments-intents/${OWNER_ORDER_ID}`), 'nor the real owner\'s intent — a refusal acts on nobody');
      },
    },

    {
      name: 'nothing else is written either',

      async run() {
        const { store } = await runRefusalWhoseStampFails();

        assert.ok(!store.get(`users/${FORGED_UID}`), 'no subscription for the forged uid');
        assert.ok(!store.get(`users/${OWNER_UID}`), 'and none for the owner');
        assert.ok(!store.get(`payments-orders/${FORGED_ORDER_ID}`), 'no order behind it');
      },
    },

    {
      name: 'the event is left failed, so the sweep re-lands the stamp',

      async run() {
        const { store } = await runRefusalWhoseStampFails();
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        assert.equal(event.status, 'failed', 'the decision was made but never recorded — the retry sweep is what re-lands it');
        assert.ok(!event.refusal, 'the stamp is exactly the write that did not land');
        assert.equal(event.retryCount, 1, 'and the attempt is counted like any other failed pass');
      },
    },

    {
      name: 'a refusal whose stamp DOES land is unaffected',

      async run() {
        // The ordinary #509 refusal, with no write fault in the way — the skip
        // above must not have taken the stamp with it.
        const record = subscriptionPayload({ uid: OWNER_UID, orderId: OWNER_ORDER_ID, resourceId: RESOURCE_ID });

        const { store } = await withStripeAnswering(record, () => runTrigger({
          uid: FORGED_UID,
          orderId: FORGED_ORDER_ID,
          resourceId: RESOURCE_ID,
          eventId: EVENT_ID,
          provider: 'stripe',
          payload: subscriptionPayload({ uid: FORGED_UID, orderId: FORGED_ORDER_ID, resourceId: RESOURCE_ID }),
          authUids: [OWNER_UID, FORGED_UID],
        }));

        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        assert.equal(event.status, 'completed', 'a refusal that records itself is terminal and acknowledged');
        assert.equal(event.refusal?.reason, 'uid-mismatch', 'and carries its reason');
        assert.ok(!store.get(`payments-intents/${FORGED_ORDER_ID}`), 'still nothing under the order the payload named');
      },
    },
  ],
};
