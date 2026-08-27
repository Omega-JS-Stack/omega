/**
 * Test: what a refund moved is the PROVIDER's number, never the payload's
 *
 * `getRefundDetails()` read the amount, the currency and the reason straight out
 * of the webhook envelope and wrote them onto the order record, into the
 * customer's refund email and into the refund conversion — so an event claiming
 * an inflated refund booked that number as money returned
 * ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)).
 *
 * The numbers come from a lookup now. Stripe is the provider under test: the
 * one-time path's fetched resource IS the charge, and the subscription path reads
 * the charge back by the id the payload names — an identifier, the same trust
 * level as the resourceId every lookup starts from. A lookup that misses is
 * refused by the #506 seam rather than filled in from the envelope.
 *
 * The SDK is the ONE thing stubbed — it is the transport boundary. Everything
 * inward runs for real: the library, the trigger, the transformers, the writes.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js).
 *
 * Run: npx omega test backend:events/payments/webhook-refund-amount-trust
 */
const assert = require('node:assert');
const { runTrigger, subscriptionPayload } = require('./_webhook-harness.js');
const Stripe = require('../../../src/manager/libraries/payment/providers/stripe.js');

const UID = '_test-refund-amount-uid';
const ORDER_ID = '5100-5100-5100';
const CHARGE_ID = 'ch_test_refund_amount';
const CHECKOUT_ID = 'cs_test_refund_amount';
const SUBSCRIPTION_ID = 'sub_test_refund_amount';
const EVENT_ID = '_test-refund-amount-evt';

// What the caller claims came back, and what Stripe's own record says did
const CLAIMED_CENTS = 99999;
const ACTUAL_CENTS = 999;

/** A Stripe charge, refunded for `amountCents` */
function charge({ amountCents, reason }) {
  return {
    id: CHARGE_ID,
    object: 'charge',
    status: 'succeeded',
    amount_refunded: amountCents,
    currency: 'usd',
    metadata: { uid: UID, orderId: ORDER_ID, productId: 'premium' },
    refunds: { data: [{ id: 're_test_refund_amount', amount: amountCents, currency: 'usd', reason: reason }] },
  };
}

/**
 * Run fn with the SDK replaced by a stand-in that answers `charge` for the charge
 * retrieve and `subscription` for the subscription one, recording every id asked for
 */
async function withStripeAnswering({ chargeAnswer, subscriptionAnswer, calls = [] }, fn) {
  const realInit = Stripe.init;

  Stripe.init = () => ({
    charges: {
      retrieve: async (id) => {
        calls.push(`charge:${id}`);

        if (typeof chargeAnswer === 'function') {
          return chargeAnswer();
        }

        return chargeAnswer;
      },
    },
    subscriptions: {
      retrieve: async (id) => {
        calls.push(`subscription:${id}`);
        return subscriptionAnswer;
      },
    },
  });

  try {
    return await fn();
  } finally {
    Stripe.init = realInit;
  }
}

/** The order the completed purchase already wrote — a refund updates it, never defines it */
function existingOrder() {
  return {
    id: ORDER_ID,
    type: 'one-time',
    owner: UID,
    productId: 'premium',
    provider: 'stripe',
    resourceId: CHECKOUT_ID,
    unified: {
      product: { id: 'premium', name: 'Premium' },
      status: 'completed',
      payment: { provider: 'stripe', orderId: ORDER_ID, resourceId: CHECKOUT_ID, price: 9.99 },
    },
    metadata: {
      created: { timestamp: '2026-08-01T00:00:00.000Z', timestampUNIX: 1785196800 },
      updated: { timestamp: '2026-08-01T00:00:00.000Z', timestampUNIX: 1785196800 },
    },
  };
}

/** The one-time refund: the charge itself is the resource the event resolves to */
function runOneTimeRefund({ chargeAnswer, calls }) {
  return withStripeAnswering({ chargeAnswer, calls }, () => runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: CHARGE_ID,
    eventId: EVENT_ID,
    eventType: 'charge.refunded',
    resourceType: 'charge',
    category: 'one-time',
    provider: 'stripe',
    payload: charge({ amountCents: CLAIMED_CENTS, reason: 'fraudulent' }),
    seed: { [`payments-orders/${ORDER_ID}`]: existingOrder() },
  }));
}

/** The subscription refund: the resource is the SUBSCRIPTION, so the charge is a second lookup */
function runSubscriptionRefund({ chargeAnswer, calls }) {
  return withStripeAnswering({
    chargeAnswer,
    subscriptionAnswer: subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: SUBSCRIPTION_ID }),
    calls,
  }, () => runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: SUBSCRIPTION_ID,
    eventId: EVENT_ID,
    eventType: 'charge.refunded',
    resourceType: 'subscription',
    category: 'subscription',
    provider: 'stripe',
    payload: charge({ amountCents: CLAIMED_CENTS, reason: 'fraudulent' }),
  }));
}

/** Stripe's own "that object does not exist" shape, as the SDK throws it */
function resourceMissing() {
  const error = new Error(`No such charge: '${CHARGE_ID}'`);

  error.type = 'StripeInvalidRequestError';
  error.code = 'resource_missing';
  error.statusCode = 404;

  return error;
}

module.exports = {
  description: 'A refund is recorded with the amount the provider says came back, never the one its payload claimed',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'an inflated payload amount never reaches the order — the provider\'s does',

      async run() {
        const { store } = await runOneTimeRefund({ chargeAnswer: charge({ amountCents: ACTUAL_CENTS, reason: 'requested_by_customer' }) });
        const refund = store.get(`payments-orders/${ORDER_ID}`)?.unified?.payment?.refund;

        assert.equal(refund.amount, '9.99', 'the amount is the one Stripe\'s record of the charge carries');
        assert.notEqual(refund.amount, '999.99', 'the number the caller posted is never the one booked');
        assert.equal(refund.currency, 'USD', 'the currency comes off the same record');
        assert.equal(refund.reason, 'requested_by_customer', 'and so does the reason');
      },
    },

    {
      name: 'the refund still marks the purchase refunded, exactly as before',

      async run() {
        const { store } = await runOneTimeRefund({ chargeAnswer: charge({ amountCents: ACTUAL_CENTS, reason: 'requested_by_customer' }) });
        const order = store.get(`payments-orders/${ORDER_ID}`);

        assert.equal(order.unified.status, 'refunded', 'the purchase reads as refunded');
        assert.equal(order.unified.product.id, 'premium', 'the purchase keeps its product');
        assert.equal(order.resourceId, CHECKOUT_ID, 'the purchase keeps the resource it was bought through');
        assert.equal(store.get(`payments-webhooks/${EVENT_ID}`)?.status, 'completed', 'the event completes');
      },
    },

    {
      name: 'a subscription refund reads the charge back from Stripe instead of the envelope',

      async run() {
        // The event resolves to the SUBSCRIPTION, which carries no refund fields at
        // all — the envelope's charge was the only thing ever read for them.
        const calls = [];

        await runSubscriptionRefund({ chargeAnswer: charge({ amountCents: ACTUAL_CENTS, reason: 'requested_by_customer' }), calls });

        assert.ok(calls.includes(`subscription:${SUBSCRIPTION_ID}`), 'the event\'s own resource is fetched as before');
        assert.ok(calls.includes(`charge:${CHARGE_ID}`), 'and the charge the refund moved is read back by its id');
      },
    },

    {
      name: 'a refund whose charge Stripe does not have is refused, not filled in from the payload',

      async run() {
        const { store } = await runSubscriptionRefund({
          chargeAnswer: () => {
            throw resourceMissing();
          },
        });

        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        assert.equal(event.refusal?.reason, 'resource-not-found', 'the #506 seam classifies the miss — the refund lookup is a lookup like any other');
        assert.equal(event.refusal?.resourceType, 'charge', 'the stamp names the lookup that actually missed');
        assert.equal(event.refusal?.resourceId, CHARGE_ID, 'and the id it missed on');
        assert.equal(event.status, 'completed', 'a resource the provider does not have is a decision, not a retry');
        assert.ok(!store.get(`users/${UID}`), 'nothing is written off an event whose numbers could not be verified');
      },
    },
  ],
};
