/**
 * Test: a refund envelope that names no charge fails loudly, not slowly
 *
 * The subscription refund path reads its charge back by the id the envelope
 * carries at `data.object.id` ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)).
 * An envelope that carries no id there handed `undefined` to
 * `stripe.charges.retrieve()`, whose throw is not a 404 — so the #506 seam
 * classified it as UNREACHABLE and the event deferred, burning the retry ladder
 * ten minutes at a time until the dead-letter ceiling. Nothing about a malformed
 * envelope gets better on the sixth attempt: it is a programmer/parser error
 * wearing a transient failure's clothes
 * ([#536](https://github.com/Omega-JS-Stack/omega/issues/536)).
 *
 * So the id is guarded BEFORE the call: the event fails terminally on the first
 * attempt, dead-lettered where it stands, with the envelope's actual shape in the
 * log so whoever reads it can see what arrived instead of a charge.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js), with
 * the Stripe SDK — the transport boundary — as the one thing stubbed.
 *
 * Run: npx omega test backend:events/payments/webhook-refund-envelope-shape
 */
const assert = require('node:assert');
const { runTrigger, subscriptionPayload } = require('./_webhook-harness.js');
const Stripe = require('../../../dist/manager/libraries/payment/providers/stripe.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-envelope-shape-uid';
const ORDER_ID = '5360-5360-5360';
const SUBSCRIPTION_ID = 'sub_test_envelope_shape';
const EVENT_ID = '_test-envelope-shape-evt';

/**
 * Run fn with the SDK replaced by one that records every charge id it is asked
 * for and throws the way Stripe does on an id that is not one
 */
async function withStripeAnswering(calls, fn) {
  const realInit = Stripe.init;

  Stripe.init = () => ({
    charges: {
      retrieve: async (id) => {
        calls.push(`charge:${id}`);

        // Stripe's own shape for a malformed request: NOT a 404, so the #506 seam
        // reads it as "could not be reached" — which is the whole bug
        const error = new Error(`Invalid charge id: ${id}`);

        error.type = 'StripeInvalidRequestError';
        error.statusCode = 400;

        throw error;
      },
    },
    subscriptions: {
      retrieve: async () => subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: SUBSCRIPTION_ID }),
    },
  });

  try {
    return await fn();
  } finally {
    Stripe.init = realInit;
  }
}

/** A charge.refunded envelope whose data.object names no charge at all */
function idlessRefund() {
  return {
    object: 'charge',
    amount_refunded: 999,
    currency: 'usd',
    refunds: { data: [{ amount: 999, currency: 'usd', reason: 'requested_by_customer' }] },
  };
}

/** The event under test: a subscription refund whose envelope carries no charge id */
function runIdlessRefund(calls = []) {
  return withStripeAnswering(calls, () => runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: SUBSCRIPTION_ID,
    eventId: EVENT_ID,
    eventType: 'charge.refunded',
    resourceType: 'subscription',
    category: 'subscription',
    provider: 'stripe',
    payload: idlessRefund(),
  }));
}

module.exports = defineCases({
  description: 'A Stripe refund envelope with no charge id is a permanent failure, not a retry',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'the charge is never asked for by an id the envelope does not have',

      async run() {
        const calls = [];

        await runIdlessRefund(calls);

        assert.ok(!calls.some((call) => call.startsWith('charge:')), 'a lookup keyed by `undefined` is not a lookup — the guard runs before the call');
      },
    },

    {
      name: 'the event is terminal on the first attempt, not deferred to the ladder',

      async run() {
        const { store } = await runIdlessRefund();
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        assert.equal(event.status, 'failed', 'a malformed envelope is a failure, not a decision the pipeline acknowledges');
        assert.equal(event.deadLetter, true, 'and a terminal one: the retry sweep must never flip it back to pending');
        assert.equal(event.retryCount, 1, 'the attempt that found it is counted, and it is the only one there will be');
      },
    },

    {
      name: 'the failure names the envelope shape that arrived',

      async run() {
        const { logs, store } = await runIdlessRefund();
        const output = logs.join('\n');

        assert.match(output, /charge\.refunded/, 'the log names the event that carried it');
        assert.match(output, /amount_refunded/, 'and the keys the envelope DID carry — the shape is what a human debugs from');
        assert.match(store.get(`payments-webhooks/${EVENT_ID}`)?.error || '', /charge id/i, 'the stamped error says what was missing');
      },
    },

    {
      name: 'nothing is written for an event whose refund could not be read',

      async run() {
        const { store } = await runIdlessRefund();

        assert.ok(!store.get(`users/${UID}`), 'no subscription lands off a refund the pipeline could not verify');
        assert.ok(!store.get(`payments-orders/${ORDER_ID}`), 'nor an order');
      },
    },
  ],
});
