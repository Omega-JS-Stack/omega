/**
 * Test: a refund record has to belong to the resource the event named
 *
 * The refund's numbers come from the provider now, looked up by an id the payload
 * carried ([#510](https://github.com/Omega-JS-Stack/omega/issues/510)) — and that
 * id was never checked against the resource the event is about. The event's own
 * resourceId is self-consistent (whatever it names is what gets fetched and
 * written), but the refund id imports numbers ACROSS records: an attacker holding
 * the webhook key could pair a real sale of their own (which passes the #509 uid
 * check) with an UNRELATED refund id from the same merchant account, and another
 * customer's refund amount landed on this order, its email and its refund
 * conversion ([#532](https://github.com/Omega-JS-Stack/omega/issues/532)).
 *
 * So every refund lookup is linked back to the event's resource, and a record that
 * belongs to something else is REFUSED — the #509 pattern: nothing is written, the
 * stamp on the event's own doc is what a human reconciles from. Each provider
 * carries its own back-pointer: a PayPal v1 refund names its `sale_id` and a v2
 * refund links `up` to its capture, a Chargebee credit note names its
 * `subscription_id`/`reference_invoice_id`, and a Stripe charge carries the
 * subscription and the uid it was made under.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js). Each
 * provider's transport is the ONE thing stubbed — Stripe's SDK, PayPal's and
 * Chargebee's HTTP call; everything inward runs for real. `provider=test` is
 * exempt by construction: it is its own API and looks nothing up.
 *
 * Run: npx omega test backend:events/payments/webhook-refund-linkage-trust
 */
const expect = require('../../../dist/vendor/devkit/test/expect.js');
const { runTrigger, subscriptionPayload } = require('./_webhook-harness.js');
const Stripe = require('../../../dist/omega/libraries/payment/providers/stripe.js');
const PayPal = require('../../../dist/omega/libraries/payment/providers/paypal.js');
const Chargebee = require('../../../dist/omega/libraries/payment/providers/chargebee.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-linkage-uid';
const ORDER_ID = '5320-5320-5320';
const EVENT_ID = '_test-linkage-evt';

// The other customer's record, in the same merchant account
const OTHER_UID = '_test-linkage-other-uid';

const STRIPE_SUBSCRIPTION_ID = 'sub_test_linkage';
const STRIPE_CHARGE_ID = 'ch_test_linkage_other';

const PAYPAL_SALE_ID = 'SALE-LINKAGE-REAL';
const PAYPAL_CAPTURE_ID = 'CAPTURE-LINKAGE-REAL';
const PAYPAL_REFUND_ID = 'REFUND-LINKAGE-OTHER';

const CHARGEBEE_SUBSCRIPTION_ID = 'cb_sub_linkage';
const CHARGEBEE_CREDIT_NOTE_ID = 'cn_linkage_other';

/** A stand-in that records every endpoint asked for and answers from `responses` */
function requestReturning(responses, calls) {
  return async (endpoint) => {
    calls.push(endpoint);

    const response = responses[endpoint];

    if (!response) {
      const error = new Error(`API 404: no stand-in response for ${endpoint}`);
      error.statusCode = 404;
      throw error;
    }

    return JSON.parse(JSON.stringify(response));
  };
}

/** The order the completed purchase already wrote — a refund updates it, never defines it */
function existingOrder({ provider, resourceId }) {
  return {
    id: ORDER_ID,
    type: 'one-time',
    owner: UID,
    productId: 'premium',
    provider: provider,
    resourceId: resourceId,
    unified: {
      product: { id: 'premium', name: 'Premium' },
      status: 'completed',
      payment: { provider: provider, orderId: ORDER_ID, resourceId: resourceId, price: 9.99 },
    },
    metadata: {
      created: { timestamp: '2026-08-01T00:00:00.000Z', timestampUNIX: 1785196800 },
      updated: { timestamp: '2026-08-01T00:00:00.000Z', timestampUNIX: 1785196800 },
    },
  };
}

// ── Stripe ──────────────────────────────────────────────────────────────────

/** A Stripe charge refunded for 42.00, linked to `subscription` and owned by `uid` */
function stripeCharge({ subscription, uid }) {
  return {
    id: STRIPE_CHARGE_ID,
    object: 'charge',
    amount_refunded: 4200,
    currency: 'usd',
    subscription: subscription,
    metadata: { uid: uid, orderId: ORDER_ID },
    refunds: { data: [{ id: 're_test_linkage', amount: 4200, currency: 'usd', reason: 'requested_by_customer' }] },
  };
}

/** The Stripe subscription refund: the charge is a second lookup, keyed by the envelope */
function runStripeRefund({ charge }) {
  const realInit = Stripe.init;

  Stripe.init = () => ({
    charges: { retrieve: async () => charge },
    subscriptions: { retrieve: async () => subscriptionPayload({ uid: UID, orderId: ORDER_ID, resourceId: STRIPE_SUBSCRIPTION_ID }) },
  });

  return runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: STRIPE_SUBSCRIPTION_ID,
    eventId: EVENT_ID,
    eventType: 'charge.refunded',
    resourceType: 'subscription',
    category: 'subscription',
    provider: 'stripe',
    payload: { ...charge, id: STRIPE_CHARGE_ID },
  }).finally(() => {
    Stripe.init = realInit;
  });
}

// ── PayPal ──────────────────────────────────────────────────────────────────

/** The PayPal v1 sale refund: the refund is its own record, keyed by the event's refundId */
function runPayPalSaleRefund({ refund, calls = [] }) {
  const realRequest = PayPal.request;

  PayPal.request = requestReturning({
    [`/v1/payments/sale/${PAYPAL_SALE_ID}`]: {
      id: PAYPAL_SALE_ID,
      state: 'refunded',
      custom_id: `uid:${UID},orderId:${ORDER_ID},productId:premium`,
      amount: { total: '9.99', currency: 'USD' },
    },
    [`/v1/payments/refund/${PAYPAL_REFUND_ID}`]: refund,
  }, calls);

  return runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: PAYPAL_SALE_ID,
    eventId: EVENT_ID,
    eventType: 'PAYMENT.SALE.REFUNDED',
    resourceType: 'sale',
    category: 'one-time',
    provider: 'paypal',
    refundId: PAYPAL_REFUND_ID,
    raw: { id: EVENT_ID, event_type: 'PAYMENT.SALE.REFUNDED', resource: { id: PAYPAL_REFUND_ID, sale_id: PAYPAL_SALE_ID } },
    seed: { [`payments-orders/${ORDER_ID}`]: existingOrder({ provider: 'paypal', resourceId: PAYPAL_SALE_ID }) },
  }).finally(() => {
    PayPal.request = realRequest;
  });
}

/** The PayPal v2 capture refund: the refund links `up` to the capture it reversed */
function runPayPalCaptureRefund({ refund, calls = [] }) {
  const realRequest = PayPal.request;

  PayPal.request = requestReturning({
    [`/v2/payments/captures/${PAYPAL_CAPTURE_ID}`]: {
      id: PAYPAL_CAPTURE_ID,
      status: 'COMPLETED',
      custom_id: `uid:${UID},orderId:${ORDER_ID},productId:premium`,
      amount: { value: '9.99', currency_code: 'USD' },
    },
    [`/v2/payments/refunds/${PAYPAL_REFUND_ID}`]: refund,
  }, calls);

  return runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: PAYPAL_CAPTURE_ID,
    eventId: EVENT_ID,
    eventType: 'PAYMENT.CAPTURE.REFUNDED',
    resourceType: 'capture',
    category: 'one-time',
    provider: 'paypal',
    refundId: PAYPAL_REFUND_ID,
    raw: { id: EVENT_ID, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: PAYPAL_REFUND_ID } },
    seed: { [`payments-orders/${ORDER_ID}`]: existingOrder({ provider: 'paypal', resourceId: PAYPAL_CAPTURE_ID }) },
  }).finally(() => {
    PayPal.request = realRequest;
  });
}

/** A v2 refund record whose `up` link names `captureId` */
function paypalV2Refund(captureId) {
  return {
    id: PAYPAL_REFUND_ID,
    status: 'COMPLETED',
    amount: { value: '42.00', currency_code: 'USD' },
    links: [
      { rel: 'self', href: `https://api-m.paypal.com/v2/payments/refunds/${PAYPAL_REFUND_ID}` },
      { rel: 'up', href: `https://api-m.paypal.com/v2/payments/captures/${captureId}` },
    ],
  };
}

// ── Chargebee ───────────────────────────────────────────────────────────────

/** The Chargebee subscription refund: the credit note is its own record */
function runChargebeeRefund({ creditNote, calls = [] }) {
  const realInit = Chargebee.init;
  const realRequest = Chargebee.request;
  const nowUNIX = Math.floor(Date.now() / 1000);

  Chargebee.init = () => ({ apiKey: '_test', site: '_test', baseUrl: 'https://_test.chargebee.com/api/v2' });
  Chargebee.request = requestReturning({
    [`/subscriptions/${CHARGEBEE_SUBSCRIPTION_ID}`]: {
      subscription: {
        id: CHARGEBEE_SUBSCRIPTION_ID,
        status: 'active',
        started_at: nowUNIX,
        current_term_end: nowUNIX + 86400,
        meta_data: JSON.stringify({ uid: UID, orderId: ORDER_ID }),
        subscription_items: [{ item_price_id: 'premium-monthly' }],
      },
    },
    [`/credit_notes/${CHARGEBEE_CREDIT_NOTE_ID}`]: { credit_note: creditNote },
  }, calls);

  return runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: CHARGEBEE_SUBSCRIPTION_ID,
    eventId: EVENT_ID,
    eventType: 'payment_refunded',
    resourceType: 'subscription',
    category: 'subscription',
    provider: 'chargebee',
    raw: {
      id: EVENT_ID,
      event_type: 'payment_refunded',
      content: {
        subscription: { id: CHARGEBEE_SUBSCRIPTION_ID },
        credit_note: { id: CHARGEBEE_CREDIT_NOTE_ID, total: 99999, currency_code: 'USD' },
      },
    },
  }).finally(() => {
    Chargebee.init = realInit;
    Chargebee.request = realRequest;
  });
}

/** A credit note for 42.00, issued against `subscriptionId` */
function chargebeeCreditNote(subscriptionId) {
  return {
    id: CHARGEBEE_CREDIT_NOTE_ID,
    total: 4200,
    currency_code: 'USD',
    reason_code: 'product_unsatisfactory',
    subscription_id: subscriptionId,
  };
}

module.exports = defineCases({
  description: 'A refund record that belongs to another order is refused, never written onto this one',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'stripe: a charge made under another subscription is refused',

      async run() {
        const { store } = await runStripeRefund({
          charge: stripeCharge({ subscription: 'sub_someone_else', uid: OTHER_UID }),
        });

        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(event.refusal?.reason, 'the record the provider answered with is about another order').toBe('refund-not-linked');
        expect(event.refusal?.resourceId, 'the stamp names the resource the event claimed').toBe(STRIPE_SUBSCRIPTION_ID);
        expect(event.refusal?.linkedTo, 'and the one the refund record actually belongs to').toBe('sub_someone_else');
        expect(event.status, 'no retry can relate two unrelated records — the decision is terminal').toBe('completed');
        expect(!store.get(`users/${UID}`), 'nothing is written for an event that imported another order\'s numbers').toBeTruthy();
        expect(!store.get(`payments-orders/${ORDER_ID}`), 'no order either').toBeTruthy();
      },
    },

    {
      name: 'stripe: a charge carrying another customer\'s uid is refused too',

      async run() {
        // The charge names no subscription at all — the uid it was made under is
        // the back-pointer, and it belongs to someone else.
        const { store, logs } = await runStripeRefund({
          charge: stripeCharge({ subscription: null, uid: OTHER_UID }),
        });

        expect(store.get(`payments-webhooks/${EVENT_ID}`)?.refusal?.reason, 'a refund made under another uid is another customer\'s refund').toBe('refund-not-linked');
        expect(logs.join('\n'), 'the refusal is loud').toMatch(/REFUND NOT LINKED/);
        expect(!store.get(`users/${UID}`), 'and writes nothing').toBeTruthy();
      },
    },

    {
      name: 'stripe: the refund that DOES belong to this subscription still writes',

      async run() {
        const { store } = await runStripeRefund({
          charge: stripeCharge({ subscription: STRIPE_SUBSCRIPTION_ID, uid: UID }),
        });

        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(!event.refusal, 'a record that links back is processed exactly as before').toBeTruthy();
        expect(event.status, 'the event completes').toBe('completed');
        expect(store.get(`payments-orders/${ORDER_ID}`)?.owner, 'and the order is written').toBe(UID);
      },
    },

    {
      name: 'paypal: a v1 refund issued against another sale is refused',

      async run() {
        const { store } = await runPayPalSaleRefund({
          refund: { id: PAYPAL_REFUND_ID, state: 'completed', amount: { total: '42.00', currency: 'USD' }, sale_id: 'SALE-SOMEONE-ELSE' },
        });

        const event = store.get(`payments-webhooks/${EVENT_ID}`);
        const order = store.get(`payments-orders/${ORDER_ID}`);

        expect(event.refusal?.reason, 'the refund PayPal answered with reversed another sale').toBe('refund-not-linked');
        expect(event.refusal?.linkedTo, 'the stamp names the sale it really belongs to').toBe('SALE-SOMEONE-ELSE');
        expect(order.unified.status, 'the purchase this event named is left exactly as it was').toBe('completed');
        expect(!order.unified.payment?.refund, 'with no refund on it').toBeTruthy();
      },
    },

    {
      name: 'paypal: a v1 refund of the sale the event names writes as before',

      async run() {
        const { store } = await runPayPalSaleRefund({
          refund: { id: PAYPAL_REFUND_ID, state: 'completed', amount: { total: '42.00', currency: 'USD' }, sale_id: PAYPAL_SALE_ID },
        });

        const order = store.get(`payments-orders/${ORDER_ID}`);

        expect(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'a refund that names this sale is this sale\'s refund').toBeTruthy();
        expect(order.unified.status, 'the purchase reads as refunded').toBe('refunded');
        expect(order.unified.payment.refund.amount, 'with PayPal\'s own amount').toBe('42.00');
      },
    },

    {
      name: 'paypal: a v2 refund linking up to another capture is refused',

      async run() {
        const { store } = await runPayPalCaptureRefund({ refund: paypalV2Refund('CAPTURE-SOMEONE-ELSE') });
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(event.refusal?.reason, 'the `up` link is the v2 back-pointer, and it names another capture').toBe('refund-not-linked');
        expect(event.refusal?.linkedTo, 'which the stamp names').toBe('CAPTURE-SOMEONE-ELSE');
        expect(store.get(`payments-orders/${ORDER_ID}`).unified.status, 'the purchase is untouched').toBe('completed');
      },
    },

    {
      name: 'paypal: a v2 refund linking up to this capture writes as before',

      async run() {
        const { store } = await runPayPalCaptureRefund({ refund: paypalV2Refund(PAYPAL_CAPTURE_ID) });

        expect(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'the refund links back to the capture the event named').toBeTruthy();
        expect(store.get(`payments-orders/${ORDER_ID}`).unified.payment.refund.amount, 'so its amount is recorded').toBe('42.00');
      },
    },

    {
      name: 'chargebee: a credit note issued against another subscription is refused',

      async run() {
        const { store } = await runChargebeeRefund({ creditNote: chargebeeCreditNote('cb_sub_someone_else') });
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(event.refusal?.reason, 'the credit note Chargebee answered with belongs to another subscription').toBe('refund-not-linked');
        expect(event.refusal?.linkedTo, 'the stamp names which').toBe('cb_sub_someone_else');
        expect(!store.get(`users/${UID}`), 'and nothing is written').toBeTruthy();
      },
    },

    {
      name: 'chargebee: a credit note against this subscription writes as before',

      async run() {
        const { store } = await runChargebeeRefund({ creditNote: chargebeeCreditNote(CHARGEBEE_SUBSCRIPTION_ID) });

        expect(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'a credit note that names this subscription is this subscription\'s').toBeTruthy();
        expect(store.get(`payments-orders/${ORDER_ID}`)?.owner, 'and the order is written').toBe(UID);
      },
    },
  ],
});
