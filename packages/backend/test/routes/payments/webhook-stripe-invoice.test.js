/**
 * Test: POST /payments/webhook — Stripe renewals reach the pipeline
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * A subscription renewal produces NO state transition — active → active, same
 * product — so the invoice event is the only signal that money moved. Stripe's
 * webhook processor listed `invoice.payment_failed` but not
 * `invoice.payment_succeeded`, so every renewal was dropped at the door as an
 * unsupported event type and Stripe recurring revenue never reached analytics
 * (whose `isPaymentEvent()` had been expecting that exact string all along).
 *
 * The proof runs at both ends of the door: the parser's own mapping of a real
 * invoice payload, and the route accepting the delivery and landing the pipeline
 * doc it is supposed to land.
 *
 * `invoice.paid` stays OUT by design — Stripe fires it for the same paid invoice
 * and the analytics resolver has no per-invoice dedup, so ingesting both would
 * report a renewal's revenue twice. That exclusion is asserted here so it cannot
 * be added back by accident.
 *
 * Run: npx omega test backend:routes/payments/webhook-stripe-invoice
 */
const { callHandler, withEnvironment } = require('./_route-harness.js');

const handler = require('../../../src/manager/routes/payments/webhook/post.js');
const stripeProcessor = require('../../../src/manager/routes/payments/webhook/processors/stripe.js');

const FIXTURE_INVOICE_RENEWAL = require('../../fixtures/stripe/invoice-subscription-payment-succeeded.json');

const VALID_KEY = () => process.env.OMEGA_WEBHOOK_KEY;

const renewalEvent = (id) => ({
  id: id,
  type: 'invoice.payment_succeeded',
  data: { object: FIXTURE_INVOICE_RENEWAL },
});

// Deliver key-only: the signature gate is proven in webhook-signature.test.js,
// and this suite is about which event types get through the door at all.
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
  description: 'Payment webhook: Stripe invoice events',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'supports-invoice-payment-succeeded',
      auth: 'none',
      async run({ assert }) {
        assert.ok(stripeProcessor.isSupported('invoice.payment_succeeded'), 'A Stripe renewal must be a supported event');
      },
    },

    {
      name: 'does-not-support-invoice-paid',
      auth: 'none',
      async run({ assert }) {
        // Stripe fires this alongside invoice.payment_succeeded for the same
        // invoice; ingesting both would double-count the renewal's revenue.
        assert.equal(stripeProcessor.isSupported('invoice.paid'), false, 'invoice.paid must stay out of the ingest');
      },
    },

    {
      name: 'maps-a-renewal-invoice-to-its-subscription',
      auth: 'none',
      async run({ assert }) {
        const parsed = stripeProcessor.parseWebhook({ body: renewalEvent('_test-evt-renewal-parse') });

        assert.equal(parsed.category, 'subscription', 'A subscription_cycle invoice is a subscription event');
        assert.equal(parsed.resourceType, 'subscription', 'The pipeline must re-fetch the SUBSCRIPTION, not the invoice');
        assert.equal(parsed.resourceId, 'sub_test_renewal', 'The subscription id comes off the invoice parent');
        assert.equal(parsed.uid, 'test-uid-sub-renewal', 'The uid comes off the subscription details');
      },
    },

    {
      name: 'maps-a-manual-invoice-as-one-time',
      auth: 'none',
      async run({ assert }) {
        // A one-off invoice carries no subscription billing_reason
        const event = {
          id: '_test-evt-renewal-manual',
          type: 'invoice.payment_succeeded',
          data: { object: { id: 'in_test_manual', billing_reason: 'manual', metadata: { uid: 'test-uid-manual' } } },
        };

        const parsed = stripeProcessor.parseWebhook({ body: event });

        assert.equal(parsed.category, 'one-time', 'A manual invoice is a one-time event');
        assert.equal(parsed.resourceType, 'invoice', 'A one-time invoice re-fetches as an invoice');
        assert.equal(parsed.resourceId, 'in_test_manual', 'The invoice id is the resource');
      },
    },

    {
      name: 'a-renewal-delivery-lands-a-pipeline-doc',
      auth: 'none',
      async run({ assert, Manager, firestore }) {
        const eventId = '_test-evt-renewal-ingest';

        const sent = await deliver(Manager, renewalEvent(eventId));

        assert.equal(sent.code, 200, `A renewal should be accepted, got ${sent.code}: ${JSON.stringify(sent.body)}`);
        assert.ok(!sent.body?.ignored, 'A renewal must not be ignored as an unsupported event type');

        const doc = await firestore.get(`payments-webhooks/${eventId}`);

        assert.ok(doc, 'The renewal should land a pipeline doc');
        assert.equal(doc.event.type, 'invoice.payment_succeeded', 'The pipeline doc should carry the renewal event type');
        assert.equal(doc.event.category, 'subscription', 'The pipeline doc should be categorized as a subscription event');
        assert.equal(doc.event.resourceId, 'sub_test_renewal', 'The pipeline doc should point at the subscription');
      },
    },
  ],
};
