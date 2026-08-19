/**
 * Test: a one-time refund with no order behind it is refused, not minted
 *
 * When PAYMENT.CAPTURE.REFUNDED arrived and payments-orders/{orderId} did not
 * exist, the refund event was read as a fresh purchase definition: the order was
 * created with `unified.status: 'completed'` and the REFUND's id as the resource,
 * so a reversal was booked as revenue while the transition trail said
 * one-time/purchase-refunded ([#335]). The pipeline now refuses and records the
 * event as an anomaly instead.
 *
 * The same file covers the fetched-resource log line ([#347]): the live sighting
 * was a v1 sale refund, whose resource spells its state `state`, not `status` —
 * the same lane, one payload away.
 *
 * Plain-node control-flow test (no emulator, no network): the real trigger module
 * runs against the shared in-memory Firestore stand-in (_webhook-harness.js). The
 * emulator would need a persona, a purchase and a deliberately missing order write
 * per permutation to reach the same state; the stand-in seeds it exactly.
 */
const assert = require('node:assert');
const { runTrigger } = require('./_webhook-harness.js');

const UID = '_test-refund-anomaly-uid';
const ORDER_ID = '2402-2402-2402';
const REFUND_ID = '_test-refund-id';
const CAPTURE_ID = '_test-capture-id';
const CHECKOUT_ID = '_test-checkout-id';
const EVENT_ID = '_test-refund-anomaly-evt';

/**
 * The refund resource the processor answers with: a bare charge that moved the
 * money back, naming no product and no price, linking `up` at the capture it
 * reversed the way PayPal's does.
 */
function refundPayload({ id = REFUND_ID, object = 'charge', status = 'complete' } = {}) {
  return {
    id: id,
    object: object,
    status: status,
    amount_refunded: 999,
    currency: 'usd',
    metadata: { uid: UID, orderId: ORDER_ID },
    links: [
      { rel: 'self', href: `https://api.test.invalid/v2/payments/refunds/${id}` },
      { rel: 'up', href: `https://api.test.invalid/v2/payments/captures/${CAPTURE_ID}` },
    ],
  };
}

/** The order a completed purchase already wrote, for the path that HAS one */
function existingOrder() {
  return {
    id: ORDER_ID,
    type: 'one-time',
    owner: UID,
    productId: 'premium',
    processor: 'test',
    resourceId: CHECKOUT_ID,
    unified: {
      product: { id: 'premium', name: 'Premium' },
      status: 'completed',
      payment: {
        processor: 'test',
        orderId: ORDER_ID,
        resourceId: CHECKOUT_ID,
        price: 9.99,
      },
    },
    metadata: {
      created: { timestamp: '2026-08-01T00:00:00.000Z', timestampUNIX: 1785196800 },
      updated: { timestamp: '2026-08-01T00:00:00.000Z', timestampUNIX: 1785196800 },
    },
  };
}

/** The refund event this suite is about, with only the starting state left to choose */
function runRefund({ seed = {}, payload = refundPayload(), eventType = 'charge.refunded', resourceType = 'charge' } = {}) {
  return runTrigger({
    uid: UID,
    orderId: ORDER_ID,
    resourceId: payload.id,
    eventId: EVENT_ID,
    eventType: eventType,
    resourceType: resourceType,
    category: 'one-time',
    payload: payload,
    seed: seed,
  });
}

module.exports = {
  description: 'A one-time refund with no order behind it is recorded as an anomaly, never minted as a purchase',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a refund with no order mints NO order and no intent',

      async run() {
        const { store } = await runRefund();

        assert.ok(!store.get(`payments-orders/${ORDER_ID}`), 'a refund must never define a purchase');
        assert.ok(!store.get(`payments-intents/${ORDER_ID}`), 'nothing completed, so no intent is closed out');
      },
    },

    {
      name: 'the refund is recorded as an anomaly carrying the payload and the capture it reversed',

      async run() {
        const { store } = await runRefund();
        const anomaly = store.get(`payments-anomalies/${EVENT_ID}`);

        assert.ok(anomaly, 'the event is parked durably for reconciliation');
        assert.equal(anomaly.type, 'refund-without-order', 'the record names what is wrong');
        assert.equal(anomaly.owner, UID, 'the owner it resolved to');
        assert.equal(anomaly.orderId, ORDER_ID, 'the order the refund named, which does not exist');
        assert.equal(anomaly.resource.id, REFUND_ID, 'the refund itself');
        assert.equal(anomaly.resource.captureId, CAPTURE_ID, 'the capture from links.up — the pointer back to the purchase');
        assert.equal(anomaly.refund.amount, '9.99', 'the money that moved back');
        assert.equal(anomaly.raw?.data?.object?.id, REFUND_ID, 'the refund payload as delivered');
      },
    },

    {
      name: 'the refusal is loud and the trail agrees with the record',

      async run() {
        const { store, logs } = await runRefund();
        const output = logs.join('\n');

        assert.match(output, /REFUND WITHOUT ORDER/, 'the refusal is loud');
        assert.ok(!output.includes('Transition detected: one-time/purchase-refunded'), 'no purchase was refunded, so the trail must not say one was');
        assert.equal(store.get(`payments-webhooks/${EVENT_ID}`)?.transition, null, 'the webhook records no transition');
        assert.equal(store.get(`payments-webhooks/${EVENT_ID}`)?.status, 'completed', 'the event reached a decision — it is not a retryable failure');
      },
    },

    {
      name: 'a refund WITH an order still merges onto the purchase it reversed',

      async run() {
        const { store } = await runRefund({ seed: { [`payments-orders/${ORDER_ID}`]: existingOrder() } });
        const order = store.get(`payments-orders/${ORDER_ID}`);

        assert.ok(!store.get(`payments-anomalies/${EVENT_ID}`), 'a refund with a purchase behind it is no anomaly');
        assert.equal(order.unified.status, 'refunded', 'the purchase is marked refunded');
        assert.equal(order.unified.product.id, 'premium', 'the purchase keeps its product');
        assert.equal(order.resourceId, CHECKOUT_ID, 'the purchase keeps the resource it was bought through');
        assert.equal(order.unified.payment.refund.amount, '9.99', 'the refund is recorded on the purchase');
      },
    },

    {
      name: 'the fetched-resource log reads the v1 `state` spelling, not status=unknown',

      async run() {
        // A v1 sale resource carries no `status` key at all — its state is `state`
        const payload = refundPayload({ object: 'sale' });
        delete payload.status;
        payload.state = 'refunded';

        const { logs } = await runRefund({ eventType: 'PAYMENT.SALE.REFUNDED', resourceType: 'sale', payload: payload });
        const output = logs.join('\n');

        assert.match(output, /Fetched resource: type=sale, id=_test-refund-id, status=refunded, source=processor API/, 'a v1 sale fetch logs its real state');
      },
    },
  ],
};
