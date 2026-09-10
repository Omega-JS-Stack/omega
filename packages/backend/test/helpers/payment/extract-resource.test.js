/**
 * Test: provider extractResource() — each library names its own webhook envelope
 *
 * The webhook trigger reads the resource out of the event it received to name what
 * the event is ABOUT — the orderId a failed event belongs to, and the body the test
 * provider answers its own lookups from. It used to read Stripe's envelope for every
 * provider — `raw.data.object` — so a Chargebee event (`content.<type>`) or a PayPal
 * event (`resource`) resolved to nothing at all ([#222]).
 *
 * Each library now names its own shape, and these assert the shape against the
 * real fixtures each provider's route parser already reads.
 *
 * What the envelope must NEVER do is drive state: that comes from the provider's own
 * lookup ([#506](https://github.com/Omega-JS-Stack/omega/issues/506)).
 */
const assert = require('node:assert');
const Stripe = require('../../../dist/manager/libraries/payment/providers/stripe.js');
const PayPal = require('../../../dist/manager/libraries/payment/providers/paypal.js');
const Chargebee = require('../../../dist/manager/libraries/payment/providers/chargebee.js');
const Coinbase = require('../../../dist/manager/libraries/payment/providers/coinbase.js');
const Test = require('../../../dist/manager/libraries/payment/providers/test.js');

const chargebeeSubscriptionCreated = require('../../fixtures/chargebee/webhook-subscription-created.json');
const chargebeeInvoiceOneTime = require('../../fixtures/chargebee/invoice-one-time.json');
const stripeCheckoutSession = require('../../fixtures/stripe/checkout-session-completed.json');
const coinbaseChargeConfirmed = require('../../fixtures/coinbase/charge-confirmed.json');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

// Stripe's fixtures are bare resources — a webhook wraps one in the event envelope
const stripeEvent = { id: 'evt_test_session', type: 'checkout.session.completed', data: { object: stripeCheckoutSession } };

module.exports = defineCases({
  description: 'Provider extractResource() envelope shapes',
  type: 'group',

  tests: [
    {
      name: 'stripe-reads-data-object',
      async run() {
        const resource = Stripe.extractResource(stripeEvent);

        assert.equal(resource.id, stripeCheckoutSession.id, 'Stripe nests its resource at data.object');
      },
    },

    {
      name: 'test-provider-reads-stripes-envelope',
      async run() {
        // The test provider BUILDS Stripe-shaped payloads, so it reads the Stripe
        // envelope. Without its own extractResource it fell to the empty fallback —
        // which is the whole journey lane, since every journey runs on this provider
        const resource = Test.extractResource(stripeEvent);

        assert.equal(resource.id, stripeCheckoutSession.id, 'The test provider speaks Stripe, envelope included');
        assert.equal(Test.extractResource({ id: 'evt_empty' }), null, 'And answers nothing the same way Stripe does');
      },
    },

    {
      name: 'paypal-reads-resource',
      async run() {
        const raw = { id: 'WH-TEST', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-TEST', status: 'ACTIVE' } };
        const resource = PayPal.extractResource(raw);

        assert.equal(resource.id, 'I-TEST', 'PayPal carries its resource at the top-level resource key');
      },
    },

    {
      name: 'coinbase-reads-the-data-inside-its-event-key',
      async run() {
        // Coinbase Commerce nests its charge two deep — the delivery envelope
        // wraps an EVENT, and the charge is that event's data
        // ([#642](https://github.com/Omega-JS-Stack/omega/issues/642))
        const charge = Coinbase.extractResource(coinbaseChargeConfirmed);

        assert.equal(charge.id, coinbaseChargeConfirmed.event.data.id, 'Coinbase carries its charge at event.data');
        assert.equal(Coinbase.extractResource({ id: 'delivery_only' }), null, 'And answers nothing the same way its siblings do');
      },
    },

    {
      name: 'chargebee-reads-the-content-key-of-the-event',
      async run() {
        const subscription = Chargebee.extractResource(chargebeeSubscriptionCreated);

        assert.equal(subscription.id, chargebeeSubscriptionCreated.content.subscription.id, 'A subscription event resolves content.subscription');
        assert.equal(subscription.object, 'subscription', 'The resolved resource is the subscription, not the invoice beside it');
      },
    },

    {
      name: 'chargebee-falls-to-the-invoice-when-there-is-no-subscription',
      async run() {
        // The one-time lane: invoice_generated for a non-recurring invoice carries no
        // subscription at all — the same precedence parseWebhook categorizes on
        const raw = { id: 'ev_cb_invoice_001', event_type: 'invoice_generated', content: { invoice: chargebeeInvoiceOneTime, customer: { id: 'cb_cust_001' } } };
        const resource = Chargebee.extractResource(raw);

        assert.equal(resource.id, chargebeeInvoiceOneTime.id, 'An invoice-only event resolves content.invoice');
      },
    },

    {
      name: 'an-envelope-with-no-resource-extracts-nothing',
      async run() {
        assert.equal(Chargebee.extractResource({ id: 'ev_empty', content: {} }), null, 'Chargebee: no content key, nothing to fall back to');
        assert.equal(Stripe.extractResource({ id: 'evt_empty' }), null, 'Stripe: no data.object, nothing to fall back to');
        assert.equal(PayPal.extractResource({ id: 'WH-empty' }), null, 'PayPal: no resource, nothing to fall back to');
      },
    },
  ],
});
