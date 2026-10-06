/**
 * Test: on a successful lookup, the PROVIDER's record says whose event this is
 *
 * The failed-lookup half of the trust rule was closed by
 * [#506](https://github.com/Omega-JS-Stack/omega/issues/506). This is the
 * successful half: the event's own payload carried a uid, and that uid steered
 * the write — `library.getUid(resource)` was consulted only when the payload had
 * none. So an event naming a REAL subscription id with a different metadata uid
 * moved that subscription onto the uid the caller chose
 * ([#509](https://github.com/Omega-JS-Stack/omega/issues/509)).
 *
 * The provider's record steers now, and the payload's uid is only what it is
 * checked against: a mismatch refuses the event and writes nothing at all.
 *
 * Stripe is the provider under test on purpose — `provider=test` is a
 * pass-through of Stripe's shape (its fetchResource may legitimately answer with
 * the payload object), so a mismatch can never arise there and proving anything
 * against it would prove nothing. Its protection stays the #506 production
 * refusal. The SDK is the ONE thing stubbed: it is the transport boundary, and
 * everything inward — the library, the trigger, the transformers, the writes —
 * runs for real.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js).
 *
 * Run: npx omega test backend:events/payments/webhook-uid-trust
 */
const expect = require('../../../dist/vendor/devkit/test/expect.js');
const { runTrigger, subscriptionPayload } = require('./_webhook-harness.js');
const Stripe = require('../../../dist/omega/libraries/payment/providers/stripe.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

// The subscriber the subscription actually belongs to, on Stripe's own record
const OWNER_UID = '_test-uid-trust-owner';
const OWNER_ORDER_ID = '5091-5091-5091';

// The uid the forged event claims, and the order it names
const FORGED_UID = '_test-uid-trust-forged';
const FORGED_ORDER_ID = '5090-5090-5090';

const RESOURCE_ID = 'sub_test_uid_trust';
const EVENT_ID = '_test-uid-trust-evt';

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
 * The event under test: a subscription update whose payload claims `payloadUid`,
 * answered by a Stripe record that carries `recordMetadata`.
 */
function runSubscriptionUpdated({ payloadUid, payloadOrderId, recordMetadata }) {
  const record = subscriptionPayload({ uid: OWNER_UID, orderId: OWNER_ORDER_ID, resourceId: RESOURCE_ID });

  record.metadata = recordMetadata;

  return withStripeAnswering(record, () => runTrigger({
    uid: payloadUid,
    orderId: payloadOrderId,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    provider: 'stripe',
    payload: subscriptionPayload({ uid: payloadUid, orderId: payloadOrderId, resourceId: RESOURCE_ID }),
    // Both uids are real accounts in this project — what is forged is the CLAIM,
    // not the identity, so the #399 auth guard is not what refuses this event
    authUids: [OWNER_UID, FORGED_UID],
  }));
}

/** The forged event: a real subscription id, someone else's uid in the metadata */
function runForgedEvent() {
  return runSubscriptionUpdated({
    payloadUid: FORGED_UID,
    payloadOrderId: FORGED_ORDER_ID,
    recordMetadata: { uid: OWNER_UID, orderId: OWNER_ORDER_ID },
  });
}

module.exports = defineCases({
  description: 'A webhook write is steered by the uid on the provider\'s record, never by the uid its payload claimed',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a forged uid on a real subscription writes nothing to the forged uid',

      async run() {
        const { store } = await runForgedEvent();

        expect(!store.get(`users/${FORGED_UID}`), 'the uid the caller chose must never receive a subscription it did not buy').toBeTruthy();
        expect(!store.get(`payments-orders/${FORGED_ORDER_ID}`), 'nor the order behind it').toBeTruthy();
        expect(!store.get(`payments-intents/${FORGED_ORDER_ID}`), 'nor an intent closed out for it').toBeTruthy();
      },
    },

    {
      name: 'the real owner is not written either — a refused event acts on nobody',

      async run() {
        const { store } = await runForgedEvent();

        expect(!store.get(`users/${OWNER_UID}`), 'a mismatch is refused, not redirected: nothing about this event is trustworthy enough to act on').toBeTruthy();
        expect(!store.get(`payments-orders/${OWNER_ORDER_ID}`), 'and no order is written under the real owner').toBeTruthy();
      },
    },

    {
      name: 'the refusal is acknowledged on the event doc and names both uids',

      async run() {
        const { store } = await runForgedEvent();
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(event.status, 'no retry can make the payload agree with the provider — the event must not be redelivered forever').toBe('completed');
        expect(event.refusal?.reason, 'the stamp names what is wrong').toBe('uid-mismatch');
        expect(event.refusal?.payloadUid, 'the stamp names the uid the payload claimed').toBe(FORGED_UID);
        expect(event.refusal?.providerUid, 'and the uid the provider\'s record actually carries').toBe(OWNER_UID);
        expect(event.transition, 'nothing happened to a subscription, so the trail must not say it did').toBe(null);
        expect(!event.retryCount, 'a terminal decision never burns the retry ladder').toBeTruthy();
      },
    },

    {
      name: 'the refusal is loud and names the provider, the resource and both uids',

      async run() {
        const { logs } = await runForgedEvent();
        const output = logs.join('\n');

        expect(output, 'the refusal is loud').toMatch(/UID MISMATCH/);
        expect(output, 'the log names the provider that was asked').toMatch(/stripe/);
        expect(output, 'the log names the resource the event claimed').toMatch(new RegExp(`subscription ${RESOURCE_ID}`));
        expect(output, 'the log names the claimed uid').toMatch(new RegExp(FORGED_UID));
        expect(output, 'and the uid the provider answered with').toMatch(new RegExp(OWNER_UID));
      },
    },

    {
      name: 'a payload uid that AGREES with the provider still writes as before',

      async run() {
        const { store } = await runSubscriptionUpdated({
          payloadUid: OWNER_UID,
          payloadOrderId: OWNER_ORDER_ID,
          recordMetadata: { uid: OWNER_UID, orderId: OWNER_ORDER_ID },
        });

        expect(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'an event whose claim matches the record is refused nothing').toBeTruthy();
        expect(store.get(`users/${OWNER_UID}`)?.subscription?.status, 'the subscription lands on the owner\'s doc').toBe('active');
        expect(store.get(`payments-orders/${OWNER_ORDER_ID}`)?.owner, 'the order is written as before').toBe(OWNER_UID);
      },
    },

    {
      name: 'a provider record with no uid on it lets the payload steer, loudly',

      async run() {
        // Chargebee hosted-page checkouts are the real instance of this: the
        // subscription carries no meta_data until the backfill runs. There is
        // nothing to check the payload against, so it steers — and the log says so.
        const { store, logs } = await runSubscriptionUpdated({
          payloadUid: FORGED_UID,
          payloadOrderId: FORGED_ORDER_ID,
          recordMetadata: { orderId: FORGED_ORDER_ID },
        });

        expect(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'with no provider uid to disagree with, there is no mismatch to refuse').toBeTruthy();
        expect(store.get(`users/${FORGED_UID}`)?.subscription?.status, 'the payload uid steers the write').toBe('active');
        expect(logs.join('\n'), 'the fallback is named out loud — this write was never cross-checked').toMatch(/UID FALLBACK/);
      },
    },

    {
      name: 'a payload with no uid at all still resolves it from the provider record',

      async run() {
        // The pre-existing resolution path ([#347] PayPal PAYMENT.SALE) — the
        // payload carries no uid, so the provider's record is the only source.
        const { store } = await runSubscriptionUpdated({
          payloadUid: null,
          payloadOrderId: OWNER_ORDER_ID,
          recordMetadata: { uid: OWNER_UID, orderId: OWNER_ORDER_ID },
        });

        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(!event.refusal, 'a payload that claims nothing contradicts nothing').toBeTruthy();
        expect(event.owner, 'the resolved uid is persisted on the event doc').toBe(OWNER_UID);
        expect(store.get(`users/${OWNER_UID}`)?.subscription?.status, 'the subscription lands on the uid the provider named').toBe('active');
      },
    },
  ],
});
