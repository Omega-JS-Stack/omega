/**
 * Test: the hosted page is consulted BEFORE a payload uid is believed
 *
 * A Chargebee hosted-page checkout does not forward `meta_data` to the
 * subscription, so the provider's record carries no uid and the payload's claim
 * steers with a loud warn ([#509](https://github.com/Omega-JS-Stack/omega/issues/509)).
 * But Chargebee DOES hold a second authoritative source for exactly those
 * subscriptions — the hosted page's `pass_thru_content` — and the lookup that
 * reads it was gated on `!uid`, so it was consulted only when the payload claimed
 * nothing: never in the one case where a claim needed checking
 * ([#533](https://github.com/Omega-JS-Stack/omega/issues/533)).
 *
 * The lookup runs first now. A hit STEERS — and a payload that disagrees with it
 * is refused, the same refusal a mismatched record earns. A miss still falls back
 * to the payload with the warn: the scan covers only the last 25 hosted pages, so
 * "no page found" honestly means "not in the window", never "not this uid".
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js).
 * Chargebee's credentials + HTTP call are the one thing stubbed — the transport
 * boundary. Everything inward runs for real.
 *
 * Run: npx omega test backend:events/payments/webhook-hosted-page-uid-trust
 */
const assert = require('node:assert');
const { runTrigger } = require('./_webhook-harness.js');
const Chargebee = require('../../../src/manager/libraries/payment/providers/chargebee.js');

// The subscriber the hosted page says bought this subscription
const OWNER_UID = '_test-hosted-page-owner';
const OWNER_ORDER_ID = '5331-5331-5331';

// The uid a forged event claims for it, and the order it names
const FORGED_UID = '_test-hosted-page-forged';
const FORGED_ORDER_ID = '5330-5330-5330';

const SUBSCRIPTION_ID = 'cb_sub_hosted_page';
const EVENT_ID = '_test-hosted-page-evt';

const HOSTED_PAGES = '/hosted_pages?limit=25&sort_by[desc]=created_at';

/** Run fn with Chargebee's credentials + HTTP call replaced by stand-ins */
async function withChargebeeAnswering(request, fn) {
  const realInit = Chargebee.init;
  const realRequest = Chargebee.request;

  Chargebee.init = () => ({ apiKey: '_test', site: '_test', baseUrl: 'https://_test.chargebee.com/api/v2' });
  Chargebee.request = request;

  try {
    return await fn();
  } finally {
    Chargebee.init = realInit;
    Chargebee.request = realRequest;
  }
}

/** A stand-in that records every endpoint asked for and answers from `responses` */
function requestReturning(responses, calls) {
  return async (endpoint) => {
    calls.push(endpoint);

    const response = responses[endpoint];

    if (!response) {
      const error = new Error(`Chargebee API 404: no stand-in response for ${endpoint}`);
      error.statusCode = 404;
      throw error;
    }

    return JSON.parse(JSON.stringify(response));
  };
}

/** The hosted-page checkout's subscription: active, and carrying no meta_data at all */
function subscriptionRecord() {
  const nowUNIX = Math.floor(Date.now() / 1000);

  return {
    subscription: {
      id: SUBSCRIPTION_ID,
      status: 'active',
      started_at: nowUNIX,
      current_term_end: nowUNIX + 86400,
      subscription_items: [{ item_price_id: 'premium-monthly' }],
    },
  };
}

/** The last 25 hosted pages, holding the one whose pass_thru_content names the owner */
function hostedPages({ matching = true } = {}) {
  return {
    list: [
      {
        hosted_page: {
          id: 'hp_test_hosted_page',
          content: { subscription: { id: matching ? SUBSCRIPTION_ID : 'cb_sub_someone_else' } },
          pass_thru_content: JSON.stringify({ uid: OWNER_UID, orderId: OWNER_ORDER_ID }),
        },
      },
    ],
  };
}

/**
 * A hosted-page subscription event claiming `payloadUid`, with the page either in
 * the scan window or outside it
 */
function runHostedPageEvent({ payloadUid, payloadOrderId, inWindow = true, calls = [] }) {
  const responses = {
    [`/subscriptions/${SUBSCRIPTION_ID}`]: subscriptionRecord(),
    [HOSTED_PAGES]: hostedPages({ matching: inWindow }),
    // The backfill the pipeline fires after a hosted-page resolution
    [`/customers/undefined`]: {},
  };

  return withChargebeeAnswering(requestReturning(responses, calls), () => runTrigger({
    uid: payloadUid,
    orderId: payloadOrderId,
    resourceId: SUBSCRIPTION_ID,
    eventId: EVENT_ID,
    eventType: 'subscription_changed',
    provider: 'chargebee',
    raw: {
      id: EVENT_ID,
      event_type: 'subscription_changed',
      content: { subscription: { id: SUBSCRIPTION_ID, meta_data: JSON.stringify({ uid: payloadUid, orderId: payloadOrderId }) } },
    },
    // Both uids are real accounts in this project — what is forged is the CLAIM
    authUids: [OWNER_UID, FORGED_UID],
  }));
}

module.exports = {
  description: 'A payload uid is checked against the hosted page before it is allowed to steer',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a forged uid on a hosted-page subscription still in the window is refused',

      async run() {
        const calls = [];
        const { store } = await runHostedPageEvent({ payloadUid: FORGED_UID, payloadOrderId: FORGED_ORDER_ID, calls });

        assert.ok(calls.includes(HOSTED_PAGES), 'the second source is consulted exactly when the claim needs checking');
        assert.ok(!store.get(`users/${FORGED_UID}`), 'the uid the caller chose never receives a subscription it did not buy');
        assert.ok(!store.get(`users/${OWNER_UID}`), 'and the refusal acts on nobody, not even the real owner');
        assert.ok(!store.get(`payments-orders/${FORGED_ORDER_ID}`), 'no order behind it either');
      },
    },

    {
      name: 'the refusal names the hosted page as the source it disagreed with',

      async run() {
        const { store, logs } = await runHostedPageEvent({ payloadUid: FORGED_UID, payloadOrderId: FORGED_ORDER_ID });
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        assert.equal(event.status, 'completed', 'no retry can make the payload agree — the event must not be redelivered forever');
        assert.equal(event.refusal?.reason, 'uid-mismatch', 'it is the same refusal a mismatched record earns');
        assert.equal(event.refusal?.payloadUid, FORGED_UID, 'the stamp names the uid the payload claimed');
        assert.equal(event.refusal?.providerUid, OWNER_UID, 'and the uid Chargebee\'s hosted page carries');
        assert.equal(event.refusal?.source, 'hosted-page', 'and which of Chargebee\'s records answered');
        assert.match(logs.join('\n'), /UID MISMATCH/, 'the refusal is loud');
      },
    },

    {
      name: 'a subscription whose page has aged out of the window falls back, never refuses',

      async run() {
        // The scan covers the last 25 hosted pages: a null answer means "not in
        // the window", not "not this uid". Refusing on it would break every
        // hosted-page checkout older than 25 pages.
        const { store, logs } = await runHostedPageEvent({ payloadUid: FORGED_UID, payloadOrderId: FORGED_ORDER_ID, inWindow: false });

        assert.ok(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'a miss is not a mismatch');
        assert.equal(store.get(`users/${FORGED_UID}`)?.subscription?.status, 'active', 'the payload steers, as it did before');
        assert.match(logs.join('\n'), /UID FALLBACK/, 'and the write that was never cross-checked is named out loud');
      },
    },

    {
      name: 'a payload uid the hosted page AGREES with steers, and brings its orderId',

      async run() {
        const { store } = await runHostedPageEvent({ payloadUid: OWNER_UID, payloadOrderId: OWNER_ORDER_ID });

        assert.ok(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'a claim the second source confirms is refused nothing');
        assert.equal(store.get(`users/${OWNER_UID}`)?.subscription?.status, 'active', 'the subscription lands on the owner\'s doc');
        assert.equal(store.get(`payments-orders/${OWNER_ORDER_ID}`)?.owner, OWNER_UID, 'and the order the hosted page names is written with it');
      },
    },

    {
      name: 'a payload claiming no uid at all still resolves from the hosted page',

      async run() {
        // The path this lookup was written for ([#347]) — unchanged.
        const { store } = await runHostedPageEvent({ payloadUid: null, payloadOrderId: null });
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        assert.ok(!event.refusal, 'a payload that claims nothing contradicts nothing');
        assert.equal(event.owner, OWNER_UID, 'the resolved uid is persisted on the event doc');
        assert.equal(store.get(`users/${OWNER_UID}`)?.subscription?.status, 'active', 'and the subscription lands on it');
      },
    },
  ],
};
