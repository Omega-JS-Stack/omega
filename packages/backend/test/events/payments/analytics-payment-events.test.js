/**
 * Test: payment analytics event resolution
 * Unit tests for resolvePaymentEvent() — the pure resolver that decides what a
 * webhook is worth tracking as.
 *
 * The renewal path is the one that only the event type can decide: a recurring
 * charge produces no transition (active → active, same product), so a processor
 * whose renewal event is missing from isPaymentEvent() silently reports zero
 * recurring revenue. Every processor's renewal string is pinned here against its
 * own webhook parser.
 */
const analytics = require('../../../src/manager/events/firestore/payments-webhooks/analytics.js');
const paypalProcessor = require('../../../src/manager/routes/payments/webhook/processors/paypal.js');
const chargebeeProcessor = require('../../../src/manager/routes/payments/webhook/processors/chargebee.js');
const stripeProcessor = require('../../../src/manager/routes/payments/webhook/processors/stripe.js');

// A renewed paid subscription — no transition, money moved
function renewedSubscription() {
  return {
    product: { id: 'premium', name: 'Premium' },
    status: 'active',
    trial: { claimed: false },
    payment: { frequency: 'monthly', price: 9.99, resourceId: '_test-sub-analytics' },
  };
}

function resolveRenewal(eventType) {
  return analytics.resolvePaymentEvent('subscription', null, eventType, renewedSubscription(), {});
}

module.exports = {
  description: 'Payment analytics event resolution (renewals per processor)',
  type: 'group',

  tests: [
    {
      name: 'stripe-renewal-tracks',
      async run({ assert }) {
        const resolved = resolveRenewal('invoice.payment_succeeded');

        assert.ok(resolved, 'A Stripe renewal should resolve to a trackable event');
        assert.equal(resolved.reason, 'renewal', 'Reason should be renewal');
        assert.equal(resolved.value, 9.99, 'Renewals track the full price');
        assert.ok(stripeProcessor.isSupported('invoice.payment_succeeded'), 'Stripe processor should accept the same event string');

        // `invoice.paid` stays out of the INGEST on purpose: Stripe fires it for
        // the same paid invoice, and this resolver has no per-invoice dedup, so
        // ingesting both would report a renewal's revenue twice. The resolver
        // still accepts the string for a brand that pins its endpoint to it —
        // which is exactly why the ingest side has to be the one that decides.
        assert.equal(stripeProcessor.isSupported('invoice.paid'), false, 'Only one Stripe invoice event may be ingested per renewal');
      },
    },

    {
      name: 'paypal-renewal-tracks',
      async run({ assert }) {
        const resolved = resolveRenewal('PAYMENT.SALE.COMPLETED');

        assert.ok(resolved, 'A PayPal renewal should resolve to a trackable event');
        assert.equal(resolved.reason, 'renewal', 'Reason should be renewal');
        assert.ok(paypalProcessor.isSupported('PAYMENT.SALE.COMPLETED'), 'PayPal processor should accept the same event string');
      },
    },

    {
      name: 'chargebee-renewal-tracks',
      async run({ assert }) {
        const resolved = resolveRenewal('subscription_renewed');

        assert.ok(resolved, 'A Chargebee renewal should resolve to a trackable event');
        assert.equal(resolved.reason, 'renewal', 'Reason should be renewal');
        assert.equal(resolved.isRecurring, true, 'Renewals are recurring revenue');
        assert.ok(chargebeeProcessor.isSupported('subscription_renewed'), 'Chargebee processor should accept the same event string');
      },
    },

    {
      name: 'win-back-tracks-a-purchase-not-a-renewal',
      async run({ assert }) {
        // A returning subscriber's checkout arrives on a payment event, so before
        // the win-back transition existed this resolved as a renewal — recurring
        // revenue reported for what is a fresh purchase
        const resolved = analytics.resolvePaymentEvent('subscription', 'subscription-winback', 'invoice.payment_succeeded', renewedSubscription(), {});

        assert.ok(resolved, 'A win-back should resolve to a trackable event');
        assert.equal(resolved.reason, 'winback-purchase', 'Reason should be winback-purchase');
        assert.equal(resolved.isRecurring, false, 'A win-back is a purchase, not recurring revenue');
        assert.equal(resolved.value, 9.99, 'Value should be what the customer paid');
      },
    },

    {
      name: 'a-declined-checkout-tracks-nothing',
      async run({ assert }) {
        // No money moved — the transition exists to suppress the dunning email,
        // not to report revenue
        const resolved = analytics.resolvePaymentEvent('subscription', 'checkout-declined', 'invoice.payment_failed', renewedSubscription(), {});

        assert.equal(resolved, null, 'A declined checkout should track nothing');
      },
    },

    {
      name: 'non-payment-event-tracks-nothing',
      async run({ assert }) {
        const resolved = resolveRenewal('subscription_changed');

        assert.equal(resolved, null, 'An event where no money moved should track nothing');
      },
    },
  ],
};
