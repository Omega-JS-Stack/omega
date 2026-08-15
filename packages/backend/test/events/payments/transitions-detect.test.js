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
 *   3. The one-time side of the same question — detectOneTimeTransition() reads
 *      the event type alone, so EVERY one-time transition needs that same
 *      idempotency guard, not just the refund
 *
 * And the state rules, where ORDER inside the array is the behavior: each rule
 * added here is proved to fire AND proved not to shadow the rule it sits in
 * front of ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 */
const fs = require('fs');
const path = require('path');
const transitions = require('../../../src/manager/events/firestore/payments-webhooks/transitions/index.js');
const stripeProcessor = require('../../../src/manager/routes/payments/webhook/processors/stripe.js');
const paypalProcessor = require('../../../src/manager/routes/payments/webhook/processors/paypal.js');
const chargebeeProcessor = require('../../../src/manager/routes/payments/webhook/processors/chargebee.js');

// Every transition name the detector can return, and the category whose folder
// holds its handler file
const HANDLED_TRANSITIONS = [
  ['subscription', 'new-subscription'],
  ['subscription', 'subscription-winback'],
  ['subscription', 'checkout-declined'],
  ['subscription', 'payment-failed'],
  ['subscription', 'payment-recovered'],
  ['subscription', 'cancellation-requested'],
  ['subscription', 'cancellation-removed'],
  ['subscription', 'subscription-cancelled'],
  ['subscription', 'plan-changed'],
  ['subscription', 'payment-refunded'],
  ['one-time', 'purchase-completed'],
  ['one-time', 'purchase-failed'],
  ['one-time', 'purchase-refunded'],
];

// A paid, active unified subscription — the shape a refund webhook arrives against
function paidSubscription() {
  return {
    product: { id: 'premium', name: 'Premium' },
    status: 'active',
    cancellation: { pending: false },
    payment: { frequency: 'monthly', price: 9.99 },
  };
}

// A user doc's birth state: active on basic, never subscribed to anything
function basicSubscription() {
  return {
    product: { id: 'basic', name: 'Basic' },
    status: 'active',
    cancellation: { pending: false },
    payment: {},
  };
}

// A fully cancelled paid subscriber — the state a win-back starts from
function cancelledSubscription() {
  return {
    product: { id: 'premium', name: 'Premium' },
    status: 'cancelled',
    cancellation: { pending: false },
    payment: { frequency: 'monthly', price: 9.99 },
  };
}

module.exports = {
  description: 'Payment transition detection (state rules, refund events + idempotency)',
  type: 'group',

  tests: [
    // ─── State rules: win-back ───

    {
      name: 'detects-a-win-back',
      async run({ assert }) {
        // A subscriber who cancelled outright and came back: the product id stays
        // paid through the cancellation, so no rule but this one describes it
        const detected = transitions.detectSubscriptionTransition(cancelledSubscription(), paidSubscription(), 'customer.subscription.created');

        assert.equal(detected, 'subscription-winback', 'cancelled paid → active paid should detect subscription-winback');
      },
    },

    {
      name: 'a-first-subscription-is-still-new-subscription',
      async run({ assert }) {
        // The win-back rule sits behind new-subscription — a user arriving from
        // basic is still buying for the first time
        const detected = transitions.detectSubscriptionTransition(basicSubscription(), paidSubscription(), 'customer.subscription.created');

        assert.equal(detected, 'new-subscription', 'basic → active paid should still detect new-subscription');
      },
    },

    {
      name: 'a-cancelled-basic-user-subscribing-is-still-new-subscription',
      async run({ assert }) {
        // A cancellation that also downgraded the product leaves nothing to win
        // back — that user reads as a first purchase, as it always has
        const before = cancelledSubscription();
        before.product = { id: 'basic', name: 'Basic' };

        const detected = transitions.detectSubscriptionTransition(before, paidSubscription(), 'customer.subscription.created');

        assert.equal(detected, 'new-subscription', 'cancelled basic → active paid should still detect new-subscription');
      },
    },

    // ─── State rules: checkout decline ───

    {
      name: 'detects-a-first-checkout-decline',
      async run({ assert }) {
        // A user doc is born active on basic, so a declined FIRST checkout is
        // basic active → suspended: a checkout the user is watching fail, not a
        // renewal that needs dunning
        const after = paidSubscription();
        after.status = 'suspended';

        const detected = transitions.detectSubscriptionTransition(basicSubscription(), after, 'customer.subscription.created');

        assert.equal(detected, 'checkout-declined', 'basic → suspended should detect checkout-declined');
      },
    },

    {
      name: 'a-new-user-declining-is-also-a-checkout-decline',
      async run({ assert }) {
        // No user doc at all (no before state) is the same case
        const after = paidSubscription();
        after.status = 'suspended';

        const detected = transitions.detectSubscriptionTransition(null, after, 'customer.subscription.created');

        assert.equal(detected, 'checkout-declined', 'null → suspended should detect checkout-declined');
      },
    },

    {
      name: 'detects-a-declined-win-back-checkout',
      async run({ assert }) {
        // The win-back branch of the same moment: a full cancellation leaves the
        // PAID product id on the user doc, so a returning subscriber whose payment
        // declines is cancelled paid → suspended — not the rule above (before must
        // be basic), not subscription-winback (after must be active), not
        // payment-failed (before must be active). It matched nothing at all, and
        // the webhook completed with no log and no analytics
        // ([#223](https://github.com/Omega-JS-Stack/omega/issues/223))
        const after = paidSubscription();
        after.status = 'suspended';

        const detected = transitions.detectSubscriptionTransition(cancelledSubscription(), after, 'customer.subscription.created');

        assert.equal(detected, 'checkout-declined', 'cancelled paid → suspended should detect checkout-declined');
      },
    },

    {
      name: 'a-returning-subscriber-who-pays-is-still-a-win-back',
      async run({ assert }) {
        // The declined-win-back rule sits BEHIND subscription-winback — the same
        // before state, and only the outcome tells them apart
        const detected = transitions.detectSubscriptionTransition(cancelledSubscription(), paidSubscription(), 'customer.subscription.created');

        assert.equal(detected, 'subscription-winback', 'cancelled paid → active paid should still detect subscription-winback');
      },
    },

    {
      name: 'a-paying-subscriber-still-gets-payment-failed',
      async run({ assert }) {
        // The decline rule sits in FRONT of payment-failed, so this is the one
        // that proves it did not swallow the dunning case it precedes
        const after = paidSubscription();
        after.status = 'suspended';

        const detected = transitions.detectSubscriptionTransition(paidSubscription(), after, 'invoice.payment_failed');

        assert.equal(detected, 'payment-failed', 'active paid → suspended should still detect payment-failed');
      },
    },

    {
      name: 'a-second-decline-event-fires-nothing',
      async run({ assert }) {
        // The declined checkout's failed invoice arrives after the subscription
        // event already suspended the user — suspended → suspended, no repeat
        const before = paidSubscription();
        before.status = 'suspended';
        const after = paidSubscription();
        after.status = 'suspended';

        const detected = transitions.detectSubscriptionTransition(before, after, 'invoice.payment_failed');

        assert.equal(detected, null, 'suspended → suspended should detect nothing');
      },
    },

    // ─── State rules: cancellation withdrawn ───

    {
      name: 'detects-a-cancellation-being-withdrawn',
      async run({ assert }) {
        const before = paidSubscription();
        before.cancellation = { pending: true };

        const detected = transitions.detectSubscriptionTransition(before, paidSubscription(), 'customer.subscription.updated');

        assert.equal(detected, 'cancellation-removed', 'pending true → false while active should detect cancellation-removed');
      },
    },

    {
      name: 'a-cancellation-being-scheduled-is-still-cancellation-requested',
      async run({ assert }) {
        const after = paidSubscription();
        after.cancellation = { pending: true };

        const detected = transitions.detectSubscriptionTransition(paidSubscription(), after, 'customer.subscription.updated');

        assert.equal(detected, 'cancellation-requested', 'pending false → true should still detect cancellation-requested');
      },
    },

    {
      name: 'a-recovery-that-clears-a-pending-cancellation-is-still-payment-recovered',
      async run({ assert }) {
        // The withdrawal rule sits BEHIND payment-recovered — money moving is the
        // more meaningful half of a suspended subscriber coming back
        const before = paidSubscription();
        before.status = 'suspended';
        before.cancellation = { pending: true };

        const detected = transitions.detectSubscriptionTransition(before, paidSubscription(), 'invoice.payment_succeeded');

        assert.equal(detected, 'payment-recovered', 'suspended → active should still detect payment-recovered');
      },
    },

    {
      name: 'a-plan-change-that-clears-a-pending-cancellation-is-still-plan-changed',
      async run({ assert }) {
        // Same product is part of the rule, so switching plans stays a plan change
        const before = paidSubscription();
        before.cancellation = { pending: true };
        const after = paidSubscription();
        after.product = { id: 'pro', name: 'Pro' };

        const detected = transitions.detectSubscriptionTransition(before, after, 'customer.subscription.updated');

        assert.equal(detected, 'plan-changed', 'A different product should still detect plan-changed');
      },
    },

    // ─── Every rule has somewhere to dispatch ───

    {
      name: 'every-detectable-transition-has-a-handler-file',
      async run({ assert }) {
        // dispatch() resolves <category>/<name>.js by name — a rule whose handler
        // file is missing logs "not found" and silently sends the customer nothing
        const root = path.join(__dirname, '../../../src/manager/events/firestore/payments-webhooks/transitions');

        for (const [category, name] of HANDLED_TRANSITIONS) {
          const handlerPath = path.join(root, category, `${name}.js`);

          assert.ok(fs.existsSync(handlerPath), `Transition ${category}/${name} should have a handler file`);
          assert.equal(typeof require(handlerPath), 'function', `Transition ${category}/${name} handler should export a function`);
        }
      },
    },

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

    // ─── One-time refunds ───

    {
      name: 'detects-a-one-time-refund',
      async run({ assert }) {
        const detected = transitions.detectOneTimeTransition('charge.refunded');

        assert.equal(detected, 'purchase-refunded', 'A refunded one-time purchase should detect purchase-refunded');
      },
    },

    {
      name: 'every-refund-event-detects-on-the-one-time-side',
      async run({ assert }) {
        // The one-time side reads the same processor strings the subscription
        // side does — a refund is a refund whichever thing was bought
        for (const eventType of transitions.REFUND_EVENTS) {
          assert.equal(
            transitions.detectOneTimeTransition(eventType),
            'purchase-refunded',
            `${eventType} should detect purchase-refunded for a one-time purchase`,
          );
        }
      },
    },

    {
      name: 'dispatches-a-one-time-refund-through-detect-transition',
      async run({ assert }) {
        // The path on-write actually calls: category + event type, no before state
        const detected = transitions.detectTransition('one-time', null, { product: { id: 'credits' }, status: 'completed' }, 'charge.refunded');

        assert.equal(detected, 'purchase-refunded', 'A one-time refund should route to purchase-refunded');
      },
    },

    {
      name: 'a-one-time-purchase-still-detects-purchase-completed',
      async run({ assert }) {
        // The refund mapping must not shadow the events already on this side
        assert.equal(transitions.detectOneTimeTransition('checkout.session.completed'), 'purchase-completed', 'A completed checkout is still a purchase');
        assert.equal(transitions.detectOneTimeTransition('CHECKOUT.ORDER.APPROVED'), 'purchase-completed', 'An approved PayPal order is still a purchase');
        assert.equal(transitions.detectOneTimeTransition('invoice.payment_failed'), 'purchase-failed', 'A failed one-time invoice is still a failure');
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
      name: 'a-redelivered-one-time-completion-dispatches-nothing',
      async run({ assert }) {
        // The whole one-time side reads the event type alone, so a doc that
        // already completed once would re-dispatch its confirmation email on a
        // redelivery — the same hole the subscription refund path closed
        const detected = transitions.detectOneTimeTransition('checkout.session.completed', { previouslyCompleted: true });

        assert.equal(detected, null, 'A reprocessed one-time completion should dispatch nothing (one purchase, one email)');
      },
    },

    {
      name: 'a-first-pass-one-time-completion-still-dispatches',
      async run({ assert }) {
        const detected = transitions.detectOneTimeTransition('checkout.session.completed', { previouslyCompleted: false });

        assert.equal(detected, 'purchase-completed', 'A first-pass one-time completion should still dispatch');
      },
    },

    {
      name: 'the-one-time-guard-reaches-detect-transition',
      async run({ assert }) {
        // The path on-write actually calls — the options have to travel through it
        const detected = transitions.detectTransition('one-time', null, { product: { id: 'credits' }, status: 'completed' }, 'checkout.session.completed', { previouslyCompleted: true });

        assert.equal(detected, null, 'A reprocessed one-time webhook should dispatch nothing through detectTransition');
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
