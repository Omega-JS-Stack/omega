/**
 * Test: the pipeline trusts the provider's lookup, never the caller's object
 *
 * A webhook body is whatever the caller posted. When the provider lookup failed,
 * `fetchResource()` handed that body back as the resource and the pipeline wrote
 * real subscription state and real conversions from it — unverified data driving
 * the books ([#506](https://github.com/Omega-JS-Stack/omega/issues/506)).
 *
 * The provider's own answer is now the only trusted source, and a lookup that
 * cannot be answered splits two ways:
 *
 * - **not found** — the provider affirmatively does not have the resource. The
 *   event is REFUSED and acknowledged (completed, so it is not redelivered
 *   forever), and nothing is written.
 * - **unreachable** — a timeout or a 5xx. The event DEFERS: the doc is marked
 *   failed and the retry sweep re-pends it, which is this pipeline's redelivery.
 *   Still nothing is written off the payload.
 *
 * Stripe is the provider under test because it ships the affirmative not-found
 * signal every provider is classified against (`resource_missing` / 404). The SDK
 * is the ONE thing stubbed — it is the transport boundary, and retrieving a
 * subscription needs a live Stripe account. Everything inward runs for real: the
 * library, the trigger, the transformers, the writes.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js).
 *
 * Run: npx omega test backend:events/payments/webhook-provider-lookup-trust
 */
const expect = require('../../../dist/vendor/devkit/test/expect.js');
const { runTrigger, subscriptionPayload } = require('./_webhook-harness.js');
const Stripe = require('../../../dist/omega/libraries/payment/providers/stripe.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-journey-flows-upgrade';
const ORDER_ID = '5060-5060-5060';
const RESOURCE_ID = 'sub_test_lookup_trust';
const EVENT_ID = '_test-lookup-trust-evt';

/** Run fn with the library's SDK replaced by a stand-in, restored afterwards */
async function withStripeSdk(sdk, fn) {
  const realInit = Stripe.init;

  Stripe.init = () => sdk;

  try {
    return await fn();
  } finally {
    Stripe.init = realInit;
  }
}

/** A stand-in SDK whose subscription retrieve throws `error` */
function sdkThrowing(error) {
  return {
    subscriptions: {
      retrieve: async () => {
        throw error;
      },
    },
  };
}

/** A stand-in SDK that answers with `subscription` */
function sdkReturning(subscription) {
  return {
    subscriptions: {
      retrieve: async () => subscription,
    },
  };
}

/** Stripe's own "that object does not exist" shape, as the SDK throws it */
function resourceMissing() {
  const error = new Error(`No such subscription: '${RESOURCE_ID}'`);

  error.type = 'StripeInvalidRequestError';
  error.code = 'resource_missing';
  error.statusCode = 404;

  return error;
}

/** A Stripe outage, as the SDK surfaces it: no code, no status — just unreachable */
function unreachable() {
  const error = new Error('An error occurred with our connection to Stripe. Request was retried 2 times.');

  error.type = 'StripeConnectionError';

  return error;
}

/** The event under test — a subscription update whose payload claims `active` */
function runSubscriptionUpdated(sdk) {
  return withStripeSdk(sdk, () => runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    provider: 'stripe',
    payload: subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: RESOURCE_ID }),
  }));
}

module.exports = defineCases({
  description: 'A payment webhook is processed off the provider lookup, never off its own payload',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a resource the provider does not have writes nothing at all',

      async run() {
        const { store, logs } = await runSubscriptionUpdated(sdkThrowing(resourceMissing()));

        expect(!store.get(`users/${UID}`), 'no subscription state is written from an unverified payload').toBeTruthy();
        expect(!store.get(`payments-orders/${ORDER_ID}`), 'no order is written either').toBeTruthy();
        expect(!store.get(`payments-intents/${ORDER_ID}`), 'and no intent is closed out').toBeTruthy();

        // Conversions are delivered from inside the same block that unifies the
        // resource and writes it, so an event that never unified never reported one
        expect(!logs.join('\n').includes('Unified subscription'), 'the resource is never transformed, so nothing downstream of it fires').toBeTruthy();
      },
    },

    {
      name: 'the refusal is acknowledged on the event doc, not failed',

      async run() {
        const { store } = await runSubscriptionUpdated(sdkThrowing(resourceMissing()));
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(event.status, 'no retry can conjure a resource the provider does not have — the event must not be redelivered forever').toBe('completed');
        expect(event.refusal?.reason, 'the stamp names what is wrong').toBe('resource-not-found');
        expect(event.refusal?.resourceId, 'the stamp names the resource a human reconciles from').toBe(RESOURCE_ID);
        expect(event.transition, 'nothing happened to a subscription, so the trail must not say it did').toBe(null);
        expect(!event.retryCount, 'a terminal decision never burns the retry ladder').toBeTruthy();
      },
    },

    {
      name: 'the refusal is loud and names the provider and the resource',

      async run() {
        const { logs } = await runSubscriptionUpdated(sdkThrowing(resourceMissing()));
        const output = logs.join('\n');

        expect(output, 'the refusal is loud').toMatch(/RESOURCE NOT FOUND/);
        expect(output, 'the log names the provider that was asked').toMatch(/stripe/);
        expect(output, 'the log names the resource it does not have').toMatch(new RegExp(`subscription ${RESOURCE_ID}`));
      },
    },

    {
      name: 'an unreachable provider defers for retry instead of processing the payload',

      async run() {
        const { store } = await runSubscriptionUpdated(sdkThrowing(unreachable()));
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(event.status, 'the answer exists and could not be read — the retry sweep is the reconciliation path').toBe('failed');
        expect(event.retryCount, 'the attempt is counted toward the ladder').toBe(1);
        expect(event.error, 'the recorded error says the provider was unreachable, not that the resource is gone').toMatch(/could not be reached/);
        expect(!event.refusal, 'a deferral is not a refusal — nothing was decided').toBeTruthy();

        expect(!store.get(`users/${UID}`), 'no subscription state is written from an unverified payload').toBeTruthy();
        expect(!store.get(`payments-orders/${ORDER_ID}`), 'no order is written either').toBeTruthy();
      },
    },

    {
      name: 'the provider answer wins over the object the payload carried',

      async run() {
        // The payload claims an active subscription; Stripe says it was canceled.
        // Whichever one lands on the user doc IS the trust direction.
        const canceled = {
          ...subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: RESOURCE_ID }),
          status: 'canceled',
          canceled_at: Math.floor(Date.now() / 1000),
        };

        const { store } = await runSubscriptionUpdated(sdkReturning(canceled));

        expect(store.get(`users/${UID}`)?.subscription?.status, 'the written state is the provider\'s, not the caller\'s').toBe('cancelled');
      },
    },

    {
      name: 'a lookup that answers still writes the subscription',

      async run() {
        const active = subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: RESOURCE_ID });
        const { store } = await runSubscriptionUpdated(sdkReturning(active));
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(event.status, 'the happy path still completes').toBe('completed');
        expect(!event.refusal, 'a resource the provider answered for is refused nothing').toBeTruthy();
        expect(store.get(`users/${UID}`)?.subscription?.status, 'the subscription lands on the user doc as before').toBe('active');
        expect(store.get(`payments-orders/${ORDER_ID}`)?.owner, 'the order is written as before').toBe(UID);
        expect(store.get(`payments-intents/${ORDER_ID}`)?.status, 'the intent is closed out as before').toBe('completed');
      },
    },
  ],
});
