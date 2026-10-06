/**
 * Test: a REFUSED webhook event reports itself to Sentry, at warning level
 *
 * A refusal is an attack signal — a forged owner, a resource the provider never
 * had, a refund id pointing at someone else's record — and the whole family used
 * to live in Cloud Logging and a Firestore stamp, which are only ever read by
 * someone already looking. Ian's call (2026-08-24, closing #506's open question):
 * it surfaces on the dashboard ([#550](https://github.com/Omega-JS-Stack/omega/issues/550)).
 *
 * The report rides the SHARED refusal path (`acknowledgeRefusal`), not the
 * individual catches, so every terminal decision taken before processing reports
 * exactly once and a new refusal reason inherits it for free. WARNING, not an
 * exception: nothing failed — the pipeline decided, correctly.
 *
 * The monitoring contract is the other half ([docs/shared/monitoring.md]):
 * `omega.sentry` is the backend's ONE capture handle and is null whenever no
 * DSN is configured, so an unconfigured brand reports nothing, and only IDS ride
 * — the refusal stamp's own fields plus the event's, never the payload.
 *
 * Stripe is the provider under test for both refusals: `provider=test` is a
 * pass-through of Stripe's shape, so neither a mismatch nor a not-found lookup
 * can arise there. The SDK is the ONE thing stubbed — everything inward (the
 * library, the trigger, the writes) runs for real.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js),
 * whose Sentry stand-in records what a real transport would have sent.
 *
 * Run: npx omega test backend:events/payments/webhook-refusal-reporting
 */
const expect = require('../../../dist/vendor/devkit/test/expect.js');
const { runTrigger, subscriptionPayload } = require('./_webhook-harness.js');
const Stripe = require('../../../dist/omega/libraries/payment/providers/stripe.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

// The subscriber Stripe's own record names, and the uid the forged event claims
const OWNER_UID = '_test-refusal-report-owner';
const FORGED_UID = '_test-refusal-report-forged';

const ORDER_ID = '5500-5500-5500';
const RESOURCE_ID = 'sub_test_refusal_report';
const EVENT_ID = '_test-refusal-report-evt';
const EVENT_TYPE = 'customer.subscription.updated';

/** Run fn with the library's SDK replaced by `sdk`, restored afterwards */
async function withStripeSdk(sdk, fn) {
  const realInit = Stripe.init;

  Stripe.init = () => sdk;

  try {
    return await fn();
  } finally {
    Stripe.init = realInit;
  }
}

/** Stripe's own "that object does not exist" shape, as the SDK throws it */
function resourceMissing() {
  const error = new Error(`No such subscription: '${RESOURCE_ID}'`);

  error.type = 'StripeInvalidRequestError';
  error.code = 'resource_missing';
  error.statusCode = 404;

  return error;
}

/**
 * The event under test, answered by whatever `sdk` says.
 *
 * @param {object} options
 * @param {object} options.sdk - The stand-in Stripe SDK
 * @param {string} [options.payloadUid] - The owner the event's payload claims
 * @param {boolean} [options.reporting] - Whether a DSN is configured at all
 */
function runSubscriptionUpdated({ sdk, payloadUid = OWNER_UID, reporting = true }) {
  return withStripeSdk(sdk, () => runTrigger({
    uid: payloadUid,
    orderId: ORDER_ID,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    eventType: EVENT_TYPE,
    provider: 'stripe',
    payload: subscriptionPayload({ uid: payloadUid, orderId: ORDER_ID, resourceId: RESOURCE_ID }),
    // Both uids are real accounts here — what is forged is the CLAIM, so the
    // #399 auth guard (which reports on its own path) never fires
    authUids: [OWNER_UID, FORGED_UID],
    reporting: reporting,
  }));
}

/** A stand-in SDK answering with the record Stripe really holds */
function sdkAnswering() {
  return { subscriptions: { retrieve: async () => subscriptionPayload({ uid: OWNER_UID, orderId: ORDER_ID, resourceId: RESOURCE_ID }) } };
}

/** A stand-in SDK whose lookup throws `error` */
function sdkThrowing(error) {
  return { subscriptions: { retrieve: async () => { throw error; } } };
}

module.exports = defineCases({
  description: 'A refused payment webhook reports one Sentry warning; a processed one reports nothing',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a forged owner reports exactly one warning, naming the reason, the provider and the event',

      async run() {
        const { captures, store } = await runSubscriptionUpdated({ sdk: sdkAnswering(), payloadUid: FORGED_UID });

        expect(captures.length, `A refusal reports exactly once, got ${JSON.stringify(captures)}`).toBe(1);

        const capture = captures[0];

        expect(capture.level, `A refusal is a decision, not a server fault, got ${capture.level}`).toBe('warning');
        expect(capture.tags.refusal, `The tag names the reason, got ${JSON.stringify(capture.tags)}`).toBe('uid-mismatch');
        expect(capture.tags.provider, `The tag names the provider, got ${JSON.stringify(capture.tags)}`).toBe('stripe');
        expect(capture.tags.eventId, `The event is nameable in the provider dashboard, got ${JSON.stringify(capture.tags)}`).toBe(EVENT_ID);
        expect(capture.extra.eventId, `The event id rides the report body too, got ${JSON.stringify(capture.extra)}`).toBe(EVENT_ID);
        expect(capture.extra.eventType, `The report says which event it was, got ${JSON.stringify(capture.extra)}`).toBe(EVENT_TYPE);
        expect(capture.message, `The message says what was refused, got ${capture.message}`).toMatch(/uid-mismatch/);

        expect(store.get(`payments-webhooks/${EVENT_ID}`)?.refusal?.reason, 'The reported reason is the one stamped on the event doc').toBe(capture.tags.refusal);
      },
    },

    {
      name: 'the report carries the refusal stamp and nothing off the payload',

      async run() {
        const { captures } = await runSubscriptionUpdated({ sdk: sdkAnswering(), payloadUid: FORGED_UID });
        const capture = captures[0];

        // Ids only, per the scrub rules: the stamp's own fields are the join
        // keys a human reconciles from, and the payload never rides along.
        expect(capture.extra.payloadUid, `The claimed owner rides, got ${JSON.stringify(capture.extra)}`).toBe(FORGED_UID);
        expect(capture.extra.providerUid, `The real owner rides, got ${JSON.stringify(capture.extra)}`).toBe(OWNER_UID);
        expect(!JSON.stringify(capture).includes('@'), `No email is ever assembled into the report, got ${JSON.stringify(capture)}`).toBeTruthy();
        expect(!JSON.stringify(capture).includes('current_period_end'), `The provider payload never rides, got ${JSON.stringify(capture)}`).toBeTruthy();
      },
    },

    {
      name: 'a resource the provider does not have reports the same way',

      async run() {
        // The whole family rides the one seam ([#506]) — a different refusal
        // reason needs no capture of its own.
        const { captures } = await runSubscriptionUpdated({ sdk: sdkThrowing(resourceMissing()) });

        expect(captures.length, `The #506 refusal reports too, got ${JSON.stringify(captures)}`).toBe(1);
        expect(captures[0].tags.refusal, `The tag names this reason, got ${JSON.stringify(captures[0].tags)}`).toBe('resource-not-found');
        expect(captures[0].extra.resourceId, `The stamp's resource rides, got ${JSON.stringify(captures[0].extra)}`).toBe(RESOURCE_ID);
      },
    },

    {
      name: 'a processed event reports nothing at all',

      async run() {
        const { captures, store } = await runSubscriptionUpdated({ sdk: sdkAnswering() });

        expect(captures, `An ordinary event is a non-event on the dashboard, got ${JSON.stringify(captures)}`).toEqual([]);
        expect(store.get(`users/${OWNER_UID}`)?.subscription?.status, 'The subscription is written exactly as before').toBe('active');
      },
    },

    {
      name: 'with no DSN configured the refusal still lands, reporting nothing',

      async run() {
        // `omega.sentry` is null whenever no DSN is set — the capture must be
        // a clean no-op, never a second failure on top of the refusal
        const { captures, store } = await runSubscriptionUpdated({ sdk: sdkAnswering(), payloadUid: FORGED_UID, reporting: false });

        expect(captures, `Nothing is reported when reporting is off, got ${JSON.stringify(captures)}`).toEqual([]);

        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(event?.refusal?.reason, 'The stamp still lands').toBe('uid-mismatch');
        expect(event?.status, 'The refusal is still acknowledged, not failed').toBe('completed');
        expect(!store.get(`payments-orders/${ORDER_ID}`), 'And the refused event still writes nothing').toBeTruthy();
      },
    },
  ],
});
