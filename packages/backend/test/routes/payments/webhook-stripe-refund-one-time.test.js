/**
 * Test: POST /payments/webhook — a ONE-TIME refund reaches the pipeline
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * `charge.refunded` for a charge that belongs to no subscription and no invoice
 * is the refund of a one-time purchase. The parser answered that shape with
 * `category: null`, and the route drops an uncategorized event at the door — so
 * the refund of a one-time purchase never entered the pipeline at all: no
 * transition, no order update, nothing said to the customer.
 *
 * The proof runs at both ends of the door: the parser's own mapping, and the
 * route landing the pipeline doc. The two subscription shapes are asserted
 * alongside, because the branch that categorizes a one-time refund sits directly
 * under them and must leave them exactly as they were.
 *
 * Run: npx omega test backend:routes/payments/webhook-stripe-refund-one-time
 */
const { callHandler, withEnvironment } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/webhook/post.js');
const stripeProcessor = require('../../../src/manager/routes/payments/webhook/processors/stripe.js');

const VALID_KEY = () => process.env.OMEGA_WEBHOOK_KEY;

// A refunded charge that carries no subscription and no invoice — a one-time purchase.
// Deliberately carries no orderId: this suite is about the door, and an orderId
// would pull the intent/order writes of a real purchase into it.
function oneTimeRefundedCharge() {
  return {
    id: 'ch_test_one_time_refund',
    object: 'charge',
    amount: 999,
    amount_refunded: 999,
    currency: 'usd',
    invoice: null,
    subscription: null,
    metadata: { uid: '_test-one-time-refund-uid' },
    refunds: { data: [{ id: 're_test_one_time', amount: 999, currency: 'usd', reason: 'requested_by_customer' }] },
  };
}

const refundEvent = (id, charge) => ({
  id: id,
  type: 'charge.refunded',
  data: { object: charge },
});

// Deliver key-only: the signature gate is proven in webhook-signature.test.js,
// and this suite is about which events get through the door at all.
function deliver(Manager, event) {
  return withEnvironment({ STRIPE_WEBHOOK_SECRET: null }, () => callHandler({
    Manager,
    handler,
    functionName: 'payments-webhook',
    req: {
      query: { processor: 'stripe', key: VALID_KEY() },
      body: event,
      rawBody: Buffer.from(JSON.stringify(event)),
    },
  }));
}

module.exports = {
  description: 'Payment webhook: Stripe one-time refunds',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'maps-a-one-time-charge-refund-as-one-time',
      auth: 'none',
      async run({ assert }) {
        const parsed = stripeProcessor.parseWebhook({ body: refundEvent('_test-evt-one-time-refund-parse', oneTimeRefundedCharge()) });

        assert.equal(parsed.category, 'one-time', 'A charge with no subscription and no invoice is a one-time refund');
        assert.equal(parsed.resourceType, 'charge', 'The charge is the only resource the event carries');
        assert.equal(parsed.resourceId, 'ch_test_one_time_refund', 'The charge id is the resource');
        assert.equal(parsed.uid, '_test-one-time-refund-uid', 'The uid comes off the charge metadata');
      },
    },

    {
      name: 'keeps-a-subscription-charge-refund-on-the-subscription-path',
      auth: 'none',
      async run({ assert }) {
        const charge = { ...oneTimeRefundedCharge(), subscription: 'sub_test_refund' };

        const parsed = stripeProcessor.parseWebhook({ body: refundEvent('_test-evt-sub-refund-parse', charge) });

        assert.equal(parsed.category, 'subscription', 'A charge naming a subscription stays a subscription refund');
        assert.equal(parsed.resourceType, 'subscription', 'The pipeline must re-fetch the subscription');
        assert.equal(parsed.resourceId, 'sub_test_refund', 'The subscription id is the resource');
      },
    },

    {
      name: 'keeps-an-invoiced-charge-refund-on-the-subscription-path',
      auth: 'none',
      async run({ assert }) {
        const charge = { ...oneTimeRefundedCharge(), invoice: 'in_test_refund' };

        const parsed = stripeProcessor.parseWebhook({ body: refundEvent('_test-evt-invoice-refund-parse', charge) });

        assert.equal(parsed.category, 'subscription', 'A charge carrying an invoice stays on the subscription path');
        assert.equal(parsed.resourceType, 'invoice', 'The invoice resolves the subscription downstream');
        assert.equal(parsed.resourceId, 'in_test_refund', 'The invoice id is the resource');
      },
    },

    {
      name: 'a-one-time-refund-delivery-lands-a-pipeline-doc',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const eventId = '_test-evt-one-time-refund-ingest';

        const sent = await deliver(Manager, refundEvent(eventId, oneTimeRefundedCharge()));

        assert.equal(sent.code, 200, `A one-time refund should be accepted, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.ok(!sent.body?.ignored, 'A one-time refund must not be ignored as an uncategorized event');

        const doc = await firestore.get(`payments-webhooks/${eventId}`);

        assert.ok(doc, 'The refund should land a pipeline doc');
        assert.equal(doc.event.type, 'charge.refunded', 'The pipeline doc should carry the refund event type');
        assert.equal(doc.event.category, 'one-time', 'The pipeline doc should be categorized one-time');
        assert.equal(doc.event.resourceId, 'ch_test_one_time_refund', 'The pipeline doc should point at the charge');
      },
    },
  ],
};
