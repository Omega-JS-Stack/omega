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
 *
 * Since [#385](https://github.com/Omega-JS-Stack/omega/issues/385) the resolver
 * also names the CANONICAL catalog event each transition is — the name every
 * provider's dialect is derived from — and covers the two outcomes it never
 * mapped: a refund and a cancellation that took effect.
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

// A completed one-time purchase, as the order carries it when the refund lands
function completedPurchase() {
  return {
    product: { id: 'lifetime', name: 'Lifetime' },
    status: 'completed',
    payment: { price: 99, resourceId: '_test-order-analytics' },
  };
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
        assert.equal(resolved.event, 'subscription_renewed', 'Recurring revenue has its own canonical name');
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
        assert.equal(resolved.event, 'purchase', 'A win-back is reported as a purchase');
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

    {
      // Inventory gap 4 (#328): a refund had no truth event at all, while GA4's
      // native `refund` sat unused and the dashboard's refund_action counted a
      // UI click as if it were the outcome.
      name: 'a-subscription-refund-reports-what-went-back',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'payment-refunded', 'charge.refunded', renewedSubscription(), {},
          { amount: 4.99, currency: 'USD', reason: 'requested_by_customer' }
        );

        assert.ok(resolved, 'A refund should resolve to a trackable event');
        assert.equal(resolved.event, 'refund', 'The canonical name is GA4\'s own refund event');
        assert.equal(resolved.value, 4.99, 'A partial refund reports what was actually reversed, not the price');
        assert.equal(resolved.isRecurring, false, 'Money going back is never recurring revenue');
      },
    },

    {
      name: 'a-one-time-refund-reports-the-refund-too',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent(
          'one-time', 'purchase-refunded', 'PAYMENT.CAPTURE.REFUNDED', completedPurchase(), {},
          { amount: 99, currency: 'USD', reason: null }
        );

        assert.equal(resolved.event, 'refund', 'Both categories refund through one canonical event');
        assert.equal(resolved.value, 99);
        assert.equal(resolved.productId, 'lifetime', 'The refund keeps the purchase it reversed');
      },
    },

    {
      name: 'a-refund-with-no-processor-amount-falls-back-to-the-price',
      async run({ assert }) {
        const unified = completedPurchase();
        const resolved = analytics.resolvePaymentEvent('one-time', 'purchase-refunded', 'charge.refunded', unified, {}, null);

        assert.equal(resolved.value, 99, 'A processor that names no amount still reports the reversal');
      },
    },

    {
      // Inventory gap 3 (#328): the cancellation transitions fired nothing.
      name: 'a-cancellation-that-took-effect-is-tracked',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent('subscription', 'subscription-cancelled', 'customer.subscription.deleted', renewedSubscription(), {});

        assert.ok(resolved, 'A cancellation should resolve to a trackable event');
        assert.equal(resolved.event, 'subscription_cancelled');
        assert.equal(resolved.value, 9.99, 'The value is the subscription that ended');
        assert.equal(resolved.isRecurring, false, 'Nothing was charged');
      },
    },

    {
      name: 'the-cancellation-schedule-transitions-stay-unmapped',
      async run({ assert }) {
        // Requesting a cancellation (and taking it back) changes a schedule, not
        // an outcome: the subscription is still active and may never cancel.
        for (const transition of ['cancellation-requested', 'cancellation-removed']) {
          const resolved = analytics.resolvePaymentEvent('subscription', transition, 'customer.subscription.updated', renewedSubscription(), {});

          assert.equal(resolved, null, `${transition} should track nothing`);
        }
      },
    },

    {
      // A `purchase` is the ONE payment event with a browser twin, and the
      // confirmation page can only ever compute `purchase.<orderId>` — the
      // webhook's event id never reaches a browser. Two ids for one purchase is
      // the double count dedupe exists to prevent.
      name: 'a-purchase-keys-its-dedupe-id-on-the-order-the-browser-also-knows',
      async run({ assert }) {
        const order = { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_checkout' } } } };

        const firstPurchase = analytics.resolvePaymentEvent('subscription', 'new-subscription', 'invoice.payment_succeeded', renewedSubscription(), {});
        assert.equal(analytics.resolveEventId(firstPurchase, order), 'purchase._test-order', 'the id the confirmation page will send');

        const oneTime = analytics.resolvePaymentEvent('one-time', 'purchase-completed', 'checkout.session.completed', completedPurchase(), {});
        assert.equal(analytics.resolveEventId(oneTime, order), 'purchase._test-order', 'a one-time purchase is the same event to the platforms');

        // A win-back is a second purchase on the same order, but it lands weeks or
        // months later — far outside Meta's and TikTok's ~48h dedupe windows.
        const winback = analytics.resolvePaymentEvent('subscription', 'subscription-winback', 'invoice.payment_succeeded', renewedSubscription(), {});
        assert.equal(analytics.resolveEventId(winback, order), 'purchase._test-order');
      },
    },

    {
      // Everything without a browser twin keys on the webhook delivery instead —
      // a subscription renews against the same order id month after month, so an
      // order-keyed id would have the platforms discard every renewal but the first.
      name: 'every-other-payment-event-keys-its-dedupe-id-per-webhook-delivery',
      async run({ assert }) {
        const resolved = resolveRenewal('invoice.payment_succeeded');
        const order = { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_september' } } } };

        assert.equal(analytics.resolveEventId(resolved, order), 'subscription_renewed.evt_september');
        assert.equal(
          analytics.resolveEventId(resolved, { id: '_test-order' }),
          'subscription_renewed._test-order',
          'An order with no webhook stamp still gets an id'
        );

        // October's renewal must not collide with September's.
        assert.notEqual(
          analytics.resolveEventId(resolved, { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_october' } } } }),
          analytics.resolveEventId(resolved, order),
          'Two renewals on one order are two conversions'
        );

        const refund = analytics.resolvePaymentEvent('subscription', 'payment-refunded', 'charge.refunded', renewedSubscription(), {}, { amount: 9.99 });
        assert.equal(analytics.resolveEventId(refund, order), 'refund.evt_september', 'a refund has no browser twin either');
      },
    },
  ],
};
