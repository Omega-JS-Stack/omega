/**
 * Test: payment transition detection
 * Unit tests for detectSubscriptionTransition() — a pure function over the
 * before/after unified subscription plus the webhook's event type.
 *
 * Covers the two things the event type alone decides:
 *   1. Refund detection, which must know EVERY processor's refund event string
 *      (the strings are pinned against each processor's own webhook parser here,
 *      so a parser that renames one fails this test instead of silently dropping
 *      the customer's refund email)
 *   2. Refund idempotency — a webhook doc that already completed once must not
 *      dispatch payment-refunded (and its email) a second time
 */
const transitions = require('../../../src/manager/events/firestore/payments-webhooks/transitions/index.js');
const stripeProcessor = require('../../../src/manager/routes/payments/webhook/processors/stripe.js');
const paypalProcessor = require('../../../src/manager/routes/payments/webhook/processors/paypal.js');
const chargebeeProcessor = require('../../../src/manager/routes/payments/webhook/processors/chargebee.js');

// A paid, active unified subscription — the shape a refund webhook arrives against
function paidSubscription() {
  return {
    product: { id: 'premium', name: 'Premium' },
    status: 'active',
    cancellation: { pending: false },
    payment: { frequency: 'monthly', price: 9.99 },
  };
}

module.exports = {
  description: 'Payment transition detection (refund events + refund idempotency)',
  type: 'group',

  tests: [
    // ─── Refund event strings, per processor ───

    {
      name: 'detects-stripe-refund',
      async run({ assert }) {
        const detected = transitions.detectSubscriptionTransition(paidSubscription(), paidSubscription(), 'charge.refunded');

        assert.equal(detected, 'payment-refunded', 'charge.refunded should detect payment-refunded');
        assert.ok(stripeProcessor.isSupported('charge.refunded'), 'Stripe processor should accept the same event string');
      },
    },

    {
      name: 'detects-paypal-refund',
      async run({ assert }) {
        const detected = transitions.detectSubscriptionTransition(paidSubscription(), paidSubscription(), 'PAYMENT.SALE.REFUNDED');

        assert.equal(detected, 'payment-refunded', 'PAYMENT.SALE.REFUNDED should detect payment-refunded');
        assert.ok(paypalProcessor.isSupported('PAYMENT.SALE.REFUNDED'), 'PayPal processor should accept the same event string');
      },
    },

    {
      name: 'detects-chargebee-refund',
      async run({ assert }) {
        const detected = transitions.detectSubscriptionTransition(paidSubscription(), paidSubscription(), 'payment_refunded');

        assert.equal(detected, 'payment-refunded', 'payment_refunded should detect payment-refunded');
        assert.ok(chargebeeProcessor.isSupported('payment_refunded'), 'Chargebee processor should accept the same event string');
      },
    },

    {
      name: 'every-refund-event-is-a-parsed-event',
      async run({ assert }) {
        // Each refund string must be one a webhook parser actually delivers —
        // an event no processor reports could never fire the transition
        for (const eventType of transitions.REFUND_EVENTS) {
          const supported = stripeProcessor.isSupported(eventType)
            || paypalProcessor.isSupported(eventType)
            || chargebeeProcessor.isSupported(eventType);

          assert.ok(supported, `Refund event ${eventType} should be supported by a webhook processor`);
        }
      },
    },

    // ─── Refund idempotency ───

    {
      name: 'refund-fires-on-first-pass',
      async run({ assert }) {
        const detected = transitions.detectSubscriptionTransition(
          paidSubscription(), paidSubscription(), 'charge.refunded', { previouslyCompleted: false },
        );

        assert.equal(detected, 'payment-refunded', 'A first-pass refund should dispatch');
      },
    },

    {
      name: 'refund-suppressed-when-doc-already-completed',
      async run({ assert }) {
        const detected = transitions.detectSubscriptionTransition(
          paidSubscription(), paidSubscription(), 'charge.refunded', { previouslyCompleted: true },
        );

        assert.equal(detected, null, 'A reprocessed refund webhook should dispatch nothing (one refund, one email)');
      },
    },

    {
      name: 'reprocess-does-not-suppress-other-transitions',
      async run({ assert }) {
        // The guard covers the refund path only — a reprocessed state change is
        // still detected from the before/after diff
        const before = paidSubscription();
        const after = paidSubscription();
        after.status = 'cancelled';

        const detected = transitions.detectSubscriptionTransition(
          before, after, 'customer.subscription.deleted', { previouslyCompleted: true },
        );

        assert.equal(detected, 'subscription-cancelled', 'A cancellation should still be detected on a reprocess');
      },
    },
  ],
};
