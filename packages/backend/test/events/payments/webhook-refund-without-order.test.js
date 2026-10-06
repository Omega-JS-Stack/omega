/**
 * Test: a one-time refund with no order behind it is refused, not minted
 *
 * When PAYMENT.CAPTURE.REFUNDED arrived and payments-orders/{orderId} did not
 * exist, the refund event was read as a fresh purchase definition: the order was
 * created with `unified.status: 'completed'` and the REFUND's id as the resource,
 * so a reversal was booked as revenue while the transition trail said
 * one-time/purchase-refunded ([#335]). The pipeline now refuses and stamps the
 * refusal on the event's own doc instead.
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
const expect = require('../../../dist/vendor/devkit/test/expect.js');
const { runTrigger } = require('./_webhook-harness.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const UID = '_test-refund-refusal-uid';
const ORDER_ID = '2402-2402-2402';
const REFUND_ID = '_test-refund-id';
const CAPTURE_ID = '_test-capture-id';
const CHECKOUT_ID = '_test-checkout-id';
const EVENT_ID = '_test-refund-refusal-evt';

/**
 * The refund resource the provider answers with: a bare charge that moved the
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
    provider: 'test',
    resourceId: CHECKOUT_ID,
    unified: {
      product: { id: 'premium', name: 'Premium' },
      status: 'completed',
      payment: {
        provider: 'test',
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

module.exports = defineCases({
  description: 'A one-time refund with no order behind it is refused on its own event doc, never minted as a purchase',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a refund with no order mints NO order and no intent',

      async run() {
        const { store } = await runRefund();

        expect(!store.get(`payments-orders/${ORDER_ID}`), 'a refund must never define a purchase').toBeTruthy();
        expect(!store.get(`payments-intents/${ORDER_ID}`), 'nothing completed, so no intent is closed out').toBeTruthy();
      },
    },

    {
      name: 'the refusal is stamped on the event doc with the capture it reversed',

      async run() {
        const { store } = await runRefund();
        const event = store.get(`payments-webhooks/${EVENT_ID}`);

        expect(event.refusal, 'the event doc carries the refusal durably').toBeTruthy();
        expect(event.refusal.reason, 'the stamp names what is wrong').toBe('refund-without-order');
        expect(event.refusal.captureId, 'the capture from links.up — the pointer back to the purchase').toBe(CAPTURE_ID);
        expect(event.owner, 'the owner it resolved to').toBe(UID);
        expect(event.orderId, 'the order the refund named, which does not exist').toBe(ORDER_ID);
        expect(event.raw?.data?.object?.id, 'the refund payload as delivered is already on the doc').toBe(REFUND_ID);
      },
    },

    {
      name: 'the refusal is loud and the trail agrees with the record',

      async run() {
        const { store, logs } = await runRefund();
        const output = logs.join('\n');

        expect(output, 'the refusal is loud').toMatch(/REFUND WITHOUT ORDER/);
        expect(!output.includes('Transition detected: one-time/purchase-refunded'), 'no purchase was refunded, so the trail must not say one was').toBeTruthy();
        expect(store.get(`payments-webhooks/${EVENT_ID}`)?.transition, 'the webhook records no transition').toBe(null);
        expect(store.get(`payments-webhooks/${EVENT_ID}`)?.status, 'the event reached a decision — it is not a retryable failure').toBe('completed');
      },
    },

    {
      name: 'a refund WITH an order still merges onto the purchase it reversed',

      async run() {
        const { store } = await runRefund({ seed: { [`payments-orders/${ORDER_ID}`]: existingOrder() } });
        const order = store.get(`payments-orders/${ORDER_ID}`);

        expect(!store.get(`payments-webhooks/${EVENT_ID}`)?.refusal, 'a refund with a purchase behind it is refused nothing').toBeTruthy();
        expect(order.unified.status, 'the purchase is marked refunded').toBe('refunded');
        expect(order.unified.product.id, 'the purchase keeps its product').toBe('premium');
        expect(order.resourceId, 'the purchase keeps the resource it was bought through').toBe(CHECKOUT_ID);
        expect(order.unified.payment.refund.amount, 'the refund is recorded on the purchase').toBe('9.99');
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

        expect(output, 'a v1 sale fetch logs its real state').toMatch(/Fetched resource: type=sale, id=_test-refund-id, status=refunded, source=provider API/);
      },
    },
  ],
});
