/**
 * Test: payment analytics event resolution
 * Unit tests for resolvePaymentEvent() — the pure resolver that decides what a
 * webhook is worth tracking as.
 *
 * The renewal path is the one that only the event type can decide: a recurring
 * charge produces no transition (active → active, same product), so a provider
 * whose renewal event is missing from isPaymentEvent() silently reports zero
 * recurring revenue. Every provider's renewal string is pinned here against its
 * own webhook parser.
 *
 * Since [#385](https://github.com/Omega-JS-Stack/omega/issues/385) the resolver
 * also names the CANONICAL catalog event each transition is — the name every
 * provider's dialect is derived from — and covers the two outcomes it never
 * mapped: a refund and a cancellation that took effect.
 *
 * [#407](https://github.com/Omega-JS-Stack/omega/issues/407) added the four
 * subscription lifecycle moments that were still dark or mislabeled: a plan
 * change, an uncancel, a trial that ended unpaid, and the first real charge after
 * a trial — which the generic renewal branch used to swallow. The last two turn on
 * the PRIOR state's term, so those cases pass a `before` the way the webhook does.
 *
 * [#414](https://github.com/Omega-JS-Stack/omega/issues/414) closed the two holes
 * that left: a cancellation INSIDE the trial term is the trial's outcome on every
 * provider, not paid churn, and a degraded payload carrying no term at all is not
 * a trial when the subscription is on record as already having had one.
 */
const analytics = require('../../../src/manager/events/firestore/payments-webhooks/analytics.js');
const paypalProvider = require('../../../src/manager/routes/payments/webhook/providers/paypal.js');
const chargebeeProvider = require('../../../src/manager/routes/payments/webhook/providers/chargebee.js');
const stripeProvider = require('../../../src/manager/routes/payments/webhook/providers/stripe.js');
const testProvider = require('../../../src/manager/routes/payments/webhook/providers/test.js');

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

// The trial term, as every provider reports it: while a trial runs, the
// subscription's paid-through date IS the trial's end, and only the first real
// charge moves it past.
const TRIAL_END_UNIX = 1750000000;
const NEXT_TERM_UNIX = TRIAL_END_UNIX + 30 * 24 * 60 * 60;

// The subscription DURING its trial — nothing has ever been charged
function subscriptionInTrial() {
  return {
    product: { id: 'premium', name: 'Premium' },
    status: 'active',
    trial: { claimed: true, expires: { timestampUNIX: TRIAL_END_UNIX } },
    expires: { timestampUNIX: TRIAL_END_UNIX },
    payment: { frequency: 'monthly', price: 9.99, resourceId: '_test-sub-analytics' },
  };
}

// The same subscription once a charge has carried it past the trial's end.
// `trial.claimed` is still true — it means "this subscription HAD a trial", never
// "it converted", which is exactly why the term has to be the tiebreaker.
function subscriptionAfterTrial() {
  return { ...subscriptionInTrial(), expires: { timestampUNIX: NEXT_TERM_UNIX } };
}

// The STORED subscription once its conversion has been recorded — `trial.outcome`,
// the one stored conversion signal, stamped by whichever path saw the trial end
// ([#697](https://github.com/Omega-JS-Stack/omega/issues/697)). No provider payload
// ever carries it: the unified transforms produce `claimed` + `expires` only, so this
// shape is a `before`, never an `after`.
function subscriptionConverted() {
  return { ...subscriptionAfterTrial(), trial: { ...subscriptionInTrial().trial, outcome: 'converted' } };
}

// Chargebee's in-trial payload names no `current_term_end` at all — only
// `trial_end` and `next_billing_at` (test/fixtures/chargebee/subscription-in-trial.json)
// — so `expires` folds to the epoch while `trial.expires` is real. Every trial
// rule has to see THIS shape as a trial, or Chargebee's entire trial funnel is
// dark on a provider the framework fully supports.
function chargebeeSubscriptionInTrial() {
  return { ...subscriptionInTrial(), expires: { timestampUNIX: 0 } };
}

// The degraded shape [#414] guards against: the provider API was unreachable, so
// the #222 stale fallback hands over the webhook's own body, and a Chargebee body
// that named no `current_term_end` would fold `expires` to the epoch for a PAID
// subscription exactly the way it does for a trialing one.
//
// DEFENSIVE, and deliberately so: no fixture in this repo produces an active paid
// Chargebee body with no `current_term_end` (every cancelled and active fixture
// carries one), so the premise is the issue's, not something reproduced here. What
// the fixture DOES prove is the part that matters — the two payloads are
// indistinguishable on their own (this one IS that one), so nothing but the state
// the subscription arrived FROM can ever say which is which.
function degradedPaidSubscription() {
  return chargebeeSubscriptionInTrial();
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
  description: 'Payment analytics event resolution (renewals per provider)',
  type: 'group',

  tests: [
    {
      name: 'stripe-renewal-tracks',
      async run({ assert }) {
        const resolved = resolveRenewal('invoice.payment_succeeded');

        assert.ok(resolved, 'A Stripe renewal should resolve to a trackable event');
        assert.equal(resolved.event, 'subscription_renew', 'Recurring revenue has its own canonical name');
        assert.equal(resolved.reason, 'renewal', 'Reason should be renewal');
        assert.equal(resolved.value, 9.99, 'Renewals track the full price');
        assert.ok(stripeProvider.isSupported('invoice.payment_succeeded'), 'Stripe provider should accept the same event string');

        // `invoice.paid` stays out of the INGEST on purpose: Stripe fires it for
        // the same paid invoice, and this resolver has no per-invoice dedup, so
        // ingesting both would report a renewal's revenue twice. The resolver
        // still accepts the string for a brand that pins its endpoint to it —
        // which is exactly why the ingest side has to be the one that decides.
        assert.equal(stripeProvider.isSupported('invoice.paid'), false, 'Only one Stripe invoice event may be ingested per renewal');
      },
    },

    {
      name: 'paypal-renewal-tracks',
      async run({ assert }) {
        const resolved = resolveRenewal('PAYMENT.SALE.COMPLETED');

        assert.ok(resolved, 'A PayPal renewal should resolve to a trackable event');
        assert.equal(resolved.reason, 'renewal', 'Reason should be renewal');
        assert.ok(paypalProvider.isSupported('PAYMENT.SALE.COMPLETED'), 'PayPal provider should accept the same event string');
      },
    },

    {
      name: 'chargebee-renewal-tracks',
      async run({ assert }) {
        const resolved = resolveRenewal('subscription_renewed');

        assert.ok(resolved, 'A Chargebee renewal should resolve to a trackable event');
        assert.equal(resolved.reason, 'renewal', 'Reason should be renewal');
        assert.equal(resolved.isRecurring, true, 'Renewals are recurring revenue');
        assert.ok(chargebeeProvider.isSupported('subscription_renewed'), 'Chargebee provider should accept the same event string');
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
      // native `refund` sat unused and the dashboard's user_refund_request counted a
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
      name: 'a-refund-with-no-provider-amount-falls-back-to-the-price',
      async run({ assert }) {
        const unified = completedPurchase();
        const resolved = analytics.resolvePaymentEvent('one-time', 'purchase-refunded', 'charge.refunded', unified, {}, null);

        assert.equal(resolved.value, 99, 'A provider that names no amount still reports the reversal');
      },
    },

    {
      // Inventory gap 3 (#328): the cancellation transitions fired nothing.
      name: 'a-cancellation-that-took-effect-is-tracked',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent('subscription', 'subscription-cancelled', 'customer.subscription.deleted', renewedSubscription(), {});

        assert.ok(resolved, 'A cancellation should resolve to a trackable event');
        assert.equal(resolved.event, 'subscription_cancel');
        assert.equal(resolved.value, 9.99, 'The value is the subscription that ended');
        assert.equal(resolved.isRecurring, false, 'Nothing was charged');
      },
    },

    {
      // [#414](https://github.com/Omega-JS-Stack/omega/issues/414): Chargebee ends a
      // trial with no card on file by CANCELLING it, so every no-card lapse was
      // booked as paid churn for a customer who had never paid a cent.
      name: 'a-trial-cancelled-with-no-card-on-file-is-a-lapse-not-churn',
      async run({ assert }) {
        const cancelled = { ...chargebeeSubscriptionInTrial(), status: 'cancelled' };

        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'subscription-cancelled', 'subscription_cancelled', cancelled, {}, null, chargebeeSubscriptionInTrial()
        );

        assert.ok(resolved, 'a trial cancelled at its end should resolve to a trackable event');
        assert.equal(resolved.event, 'trial_lapse', 'nobody churned: a trial ended without ever paying');
        assert.notEqual(resolved.event, 'subscription_cancel', 'a customer who never paid cannot be paid churn');
        assert.equal(resolved.value, 9.99, 'the value is the subscription that never started paying');
        assert.equal(resolved.isRecurring, false, 'nothing was ever charged');

        // The sweep derives this same id for a lapse, which collapses a race on the
        // two platforms that key on an event id. It is NOT what keeps GA4 honest —
        // GA4 deduplicates ecommerce on `transaction_id`, and a lapse is a CUSTOM
        // event with no such dedupe ([#656]) — a cancelled subscription simply
        // leaves the sweep's `status == active` candidate query.
        assert.equal(
          analytics.resolveEventId(resolved, { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_cancel' } } } }),
          'trial_lapse._test-sub-analytics',
          'the lapse keys on the SUBSCRIPTION however it was announced',
        );
      },
    },

    {
      // The rule reads the unified TERM, never a provider name: a subscriber who
      // simply quits mid-trial on Stripe or PayPal is the same story.
      name: 'a-cancellation-inside-the-trial-is-a-lapse-on-every-provider',
      async run({ assert }) {
        const cancelled = { ...subscriptionInTrial(), status: 'cancelled' };

        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'subscription-cancelled', 'customer.subscription.deleted', cancelled, {}, null, subscriptionInTrial()
        );

        assert.equal(resolved.event, 'trial_lapse', 'quitting mid-trial is the trial\'s outcome, not a churned subscriber');
        assert.equal(resolved.isRecurring, false);
      },
    },

    {
      name: 'a-cancellation-after-the-trial-is-still-paid-churn',
      async run({ assert }) {
        // The term is the only thing that moved: this subscriber converted and paid,
        // and their cancellation is the churn number it always was.
        const cancelled = { ...subscriptionAfterTrial(), status: 'cancelled' };

        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'subscription-cancelled', 'customer.subscription.deleted', cancelled, {}, null, subscriptionAfterTrial()
        );

        assert.equal(resolved.event, 'subscription_cancel', 'subscription_cancel means a PAID subscriber left');
        assert.equal(resolved.value, 9.99, 'the value is the subscription that ended');
      },
    },

    {
      // The lapse rule reads the PRIOR state, and that state is a stored delivery
      // like any other: a degraded one carries no term, which reads as a trial the
      // subscription left long ago. So the cancelled payload's own evidence has the
      // last word — a term that outlived the trial's end is a subscriber who paid.
      name: 'a-paid-cancellation-is-churn-even-when-the-stored-record-arrived-degraded',
      async run({ assert }) {
        const cancelled = { ...subscriptionAfterTrial(), status: 'cancelled' };

        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'subscription-cancelled', 'customer.subscription.deleted', cancelled, {}, null, degradedPaidSubscription()
        );

        assert.equal(resolved.event, 'subscription_cancel', 'a thin record on file cannot turn paid churn into a trial');
        assert.equal(resolved.value, 9.99);
      },
    },

    {
      // A trial that lapses tells its story ONCE, at the decline. The provider then
      // exhausts dunning and cancels the same never-converted subscription, and that
      // second webhook used to book paid churn at full price on top of the lapse —
      // the very pollution the lapse rule exists to stop.
      name: 'the-dunning-that-exhausts-a-lapsed-trial-tells-no-second-story',
      async run({ assert }) {
        // A1: the trial's charge declines. This is the outcome, and it is reported.
        const suspended = { ...subscriptionInTrial(), status: 'suspended' };
        const lapse = analytics.resolvePaymentEvent(
          'subscription', 'payment-failed', 'invoice.payment_failed', suspended, {}, null, subscriptionInTrial()
        );

        assert.equal(lapse.event, 'trial_lapse', 'the decline is where a lapsed trial is told');

        // A2: dunning runs out and the provider cancels what it was holding.
        const cancelled = { ...subscriptionInTrial(), status: 'cancelled' };
        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'subscription-cancelled', 'customer.subscription.deleted', cancelled, {}, null, suspended
        );

        assert.equal(resolved, null, 'the outcome was already told at the decline');

        // Chargebee suspends a mid-trial subscription with no term of its own, so the
        // same sequence has to read alike through the epoch-expiry shape.
        const chargebeeSuspended = { ...chargebeeSubscriptionInTrial(), status: 'suspended' };
        const chargebeeCancelled = { ...chargebeeSubscriptionInTrial(), status: 'cancelled' };

        assert.equal(
          analytics.resolvePaymentEvent('subscription', 'subscription-cancelled', 'subscription_cancelled', chargebeeCancelled, {}, null, chargebeeSuspended),
          null,
          'a term that never existed never left the trial either',
        );
      },
    },

    {
      // The boundary of the rule above: this subscriber converted and paid for
      // months before dunning took them, so the cancellation IS the churn number.
      name: 'the-dunning-that-exhausts-a-paying-subscriber-is-still-churn',
      async run({ assert }) {
        const suspended = { ...subscriptionAfterTrial(), status: 'suspended' };
        const cancelled = { ...subscriptionAfterTrial(), status: 'cancelled' };

        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'subscription-cancelled', 'customer.subscription.deleted', cancelled, {}, null, suspended
        );

        assert.equal(resolved.event, 'subscription_cancel', 'a subscriber who paid and then lapsed on dunning is churn');
        assert.equal(resolved.value, 9.99, 'the value is the subscription that ended');
      },
    },

    {
      name: 'requesting-a-cancellation-stays-event-less',
      async run({ assert }) {
        // Requesting one changes a SCHEDULE, not an outcome: the subscription is
        // still active, no money moved, and it may never cancel at all.
        const resolved = analytics.resolvePaymentEvent('subscription', 'cancellation-requested', 'customer.subscription.updated', renewedSubscription(), {});

        assert.equal(resolved, null, 'cancellation-requested should track nothing');
      },
    },

    {
      // Gap 2 (#407): the uncancel was event-less too, which left a retention win
      // completely dark. The pair is not symmetric on purpose.
      name: 'withdrawing-a-cancellation-is-a-retention-win',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent('subscription', 'cancellation-removed', 'customer.subscription.updated', renewedSubscription(), {});

        assert.ok(resolved, 'an uncancel should resolve to a trackable event');
        assert.equal(resolved.event, 'subscription_uncancel');
        assert.equal(resolved.value, 9.99, 'the value is the subscription that was kept');
        assert.equal(resolved.isRecurring, false, 'nothing was charged');
      },
    },

    {
      // Gap 1 (#407): a plan change sent an order email and fired nothing, so
      // every upgrade was invisible to every platform.
      name: 'a-plan-change-reports-the-plan-it-came-from',
      async run({ assert }) {
        const before = {
          ...renewedSubscription(),
          product: { id: 'starter', name: 'Starter' },
          payment: { frequency: 'monthly', price: 4.99, resourceId: '_test-sub-analytics' },
        };

        const resolved = analytics.resolvePaymentEvent('subscription', 'plan-changed', 'customer.subscription.updated', renewedSubscription(), {}, null, before);

        assert.ok(resolved, 'a plan change should resolve to a trackable event');
        assert.equal(resolved.event, 'subscription_plan_change');
        assert.equal(resolved.value, 9.99, 'the value is the plan they moved TO');
        assert.equal(resolved.isRecurring, false, 'no money moves at the switch itself');

        const params = analytics.buildParams({ resolved, currency: 'USD', provider: 'stripe' });

        assert.equal(params.items[0].item_id, 'premium', 'items[] is the new plan');
        assert.equal(params.previous_item_id, 'starter', 'and the from-plan rides beside it');
        assert.equal(params.previous_item_name, 'Starter');
        assert.equal(params.previous_value, 4.99, 'so the direction of the switch is readable without a second event');
      },
    },

    {
      name: 'only-a-plan-change-carries-a-previous-plan',
      async run({ assert }) {
        const params = analytics.buildParams({ resolved: resolveRenewal('invoice.payment_succeeded'), currency: 'USD', provider: 'stripe' });

        assert.equal('previous_item_id' in params, false, 'a renewal has no plan it came from');
      },
    },

    {
      // Gap 4 (#407): the conversion charge arrives exactly like a renewal — no
      // transition, a payment event — so it resolved as subscription_renew and
      // the funnel's most valuable step was undercounted.
      name: 'the-first-charge-after-a-trial-is-a-conversion-not-a-renewal',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent(
          'subscription', null, 'invoice.payment_succeeded', subscriptionAfterTrial(), {}, null, subscriptionInTrial()
        );

        assert.ok(resolved, 'a converting trial should resolve to a trackable event');
        assert.notEqual(resolved.event, 'subscription_renew', 'a conversion is not a routine renewal');
        assert.equal(resolved.event, 'trial_convert');
        assert.equal(resolved.reason, 'trial-converted');
        assert.equal(resolved.value, 9.99, 'the first real charge is what they actually paid');
        assert.equal(resolved.isRecurring, false, 'the FIRST payment is not recurring revenue');
      },
    },

    {
      // [#697](https://github.com/Omega-JS-Stack/omega/issues/697): live evidence
      // (playground order 2315-1401-3544) had Stripe deliver
      // `customer.subscription.updated` — trial over, term pushed out — a full hour
      // BEFORE `invoice.payment_succeeded`. The stored doc had already left the
      // trial by charge time, so the conversion booked as a month-two renewal. The
      // two webhooks race in real time, so an arbitrary share of conversions
      // mislabeled. Arrival order is no longer the signal.
      name: 'a-conversion-is-a-conversion-whichever-webhook-lands-first',
      async run({ assert }) {
        // The prior state the racing `customer.subscription.updated` left behind: out
        // of the trial already, on the very term this charge is paying for.
        const resolved = analytics.resolvePaymentEvent(
          'subscription', null, 'invoice.payment_succeeded', subscriptionAfterTrial(), {}, null, subscriptionAfterTrial()
        );

        assert.ok(resolved, 'the conversion charge should still resolve to a trackable event');
        assert.equal(resolved.event, 'trial_convert', 'a claimed trial with no recorded outcome has not had its first paid charge yet');
        assert.equal(resolved.isRecurring, false, 'the FIRST payment is not recurring revenue, whatever order it arrived in');
      },
    },

    {
      name: 'the-renewal-behind-a-conversion-is-a-renewal-again',
      async run({ assert }) {
        // Month two: same trial.claimed, same payment event, same term on both
        // sides — the racing conversion above is INDISTINGUISHABLE from this on
        // dates alone, which is why the stored outcome is what tells them apart.
        // The payload never carries the stamp; only the doc it arrives at does.
        const resolved = analytics.resolvePaymentEvent(
          'subscription', null, 'invoice.payment_succeeded', subscriptionAfterTrial(), {}, null, subscriptionConverted()
        );

        assert.equal(resolved.event, 'subscription_renew', 'every charge after the conversion is an ordinary renewal');
        assert.equal(resolved.isRecurring, true);
      },
    },

    {
      // The resolver decides the label and the pipeline decides the WRITE that makes
      // the next charge a renewal, so both read one predicate rather than keeping a
      // copy each ([#697]) — the same arrangement `isInsideTrial` has with the
      // trial-lapse sweep.
      name: 'the-conversion-the-pipeline-stamps-is-the-conversion-the-resolver-books',
      async run({ assert }) {
        const charge = { transitionName: null, eventType: 'invoice.payment_succeeded' };

        assert.equal(
          analytics.isTrialConversion({ ...charge, unified: subscriptionAfterTrial(), before: subscriptionAfterTrial() }),
          true,
          'the charge that converts is the one the pipeline stamps trial.outcome on',
        );
        assert.equal(
          analytics.isTrialConversion({ ...charge, unified: subscriptionAfterTrial(), before: subscriptionConverted() }),
          false,
          'and it is stamped once — a second paid charge converts nothing',
        );
        assert.equal(
          analytics.isTrialConversion({ ...charge, unified: subscriptionInTrial(), before: subscriptionInTrial() }),
          false,
          'nor does the $0 invoice a trial STARTS with',
        );
        assert.equal(
          analytics.isTrialConversion({ ...charge, unified: renewedSubscription(), before: renewedSubscription() }),
          false,
          'nor a renewal on a subscription that never claimed a trial at all',
        );
      },
    },

    {
      // Gap 3 (#407): a trial ending unpaid routed through payment-failed, which
      // sent an email and fired nothing at all.
      name: 'a-trial-that-ends-unpaid-is-a-lapse',
      async run({ assert }) {
        const suspended = { ...subscriptionInTrial(), status: 'suspended' };

        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'payment-failed', 'invoice.payment_failed', suspended, {}, null, subscriptionInTrial()
        );

        assert.ok(resolved, 'the funnel\'s failure mode should resolve to a trackable event');
        assert.equal(resolved.event, 'trial_lapse');
        assert.equal(resolved.value, 9.99, 'the value is the subscription that never started paying');
        assert.equal(resolved.isRecurring, false, 'nothing was ever charged');
      },
    },

    {
      // The trial START invoice is $0 and carries no transition, so it lands on
      // the very same branch the conversion does — and, failing that, on the
      // renewal branch, which reads the PLAN price and booked 9.99 of revenue for
      // an invoice that charged nothing. Before and after are both inside the
      // trial: nothing converted, nothing renewed, nothing was charged, so the
      // only honest answer is no event at all.
      name: 'the-zero-dollar-trial-invoice-books-nothing',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent(
          'subscription', null, 'invoice.payment_succeeded', subscriptionInTrial(), {}, null, subscriptionInTrial()
        );

        assert.notEqual(resolved?.event, 'trial_convert', 'the trial has not converted — the customer is still inside it');
        assert.equal(resolved, null, 'and a $0 invoice inside a trial is not recurring revenue either');
      },
    },

    {
      name: 'a-chargebee-zero-dollar-trial-invoice-books-nothing-either',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent(
          'subscription', null, 'invoice.payment_succeeded', chargebeeSubscriptionInTrial(), {}, null, chargebeeSubscriptionInTrial()
        );

        assert.equal(resolved, null, 'the no-term shape is inside the trial on both sides too');
      },
    },

    {
      // Chargebee names no current_term_end while a trial runs, so a term-end
      // comparison cannot see a Chargebee trial at all — the conversion fell
      // straight through to the renewal branch and the funnel stayed dark.
      name: 'a-chargebee-conversion-is-a-conversion-too',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent(
          'subscription', null, 'invoice.payment_succeeded', subscriptionAfterTrial(), {}, null, chargebeeSubscriptionInTrial()
        );

        assert.ok(resolved, 'a converting Chargebee trial should resolve to a trackable event');
        assert.equal(resolved.event, 'trial_convert', 'an epoch expiry is the ABSENCE of a term, not a term that ended in 1970');
        assert.equal(resolved.isRecurring, false);
      },
    },

    {
      name: 'a-chargebee-trial-that-ends-unpaid-is-a-lapse-too',
      async run({ assert }) {
        const suspended = { ...chargebeeSubscriptionInTrial(), status: 'suspended' };

        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'payment-failed', 'invoice.payment_failed', suspended, {}, null, chargebeeSubscriptionInTrial()
        );

        assert.ok(resolved, 'a lapsing Chargebee trial should resolve to a trackable event');
        assert.equal(resolved.event, 'trial_lapse');
      },
    },

    {
      // [#414](https://github.com/Omega-JS-Stack/omega/issues/414): the widening that
      // let the resolver see a Chargebee trial also read a DEGRADED payload as one.
      // The #222 stale fallback hands over a body with no term at all, and for a paid
      // subscriber that is a hole in the payload, not a trial. A renewal on that path
      // matched no branch and booked nothing: silent under-reporting of real revenue.
      name: 'a-renewal-on-a-degraded-payload-still-books-its-revenue',
      async run({ assert }) {
        const resolved = analytics.resolvePaymentEvent(
          'subscription', null, 'subscription_renewed', degradedPaidSubscription(), {}, null, subscriptionConverted()
        );

        assert.ok(resolved, 'a renewal must never go unreported because its payload arrived thin');
        assert.equal(resolved.event, 'subscription_renew');
        assert.equal(resolved.value, 9.99, 'the money moved whatever the payload could say about the term');
        assert.equal(resolved.isRecurring, true);

        // The bound needs one healthy delivery behind it. Two degraded deliveries in
        // a row leave no term on either side, and that renewal still books nothing —
        // narrower than the hole it closes, and it fails toward silence.
        assert.equal(
          analytics.resolvePaymentEvent('subscription', null, 'subscription_renewed', degradedPaidSubscription(), {}, null, degradedPaidSubscription()),
          null,
          'nothing on either side names a term, so nothing can prove this was not a trial',
        );
      },
    },

    {
      name: 'a-dunning-failure-months-after-a-trial-is-not-a-lapse',
      async run({ assert }) {
        // The same active → suspended shape and the same trial.claimed. Only the
        // term tells them apart: this subscriber has been paying for months.
        const suspended = { ...subscriptionAfterTrial(), status: 'suspended' };

        const resolved = analytics.resolvePaymentEvent(
          'subscription', 'payment-failed', 'invoice.payment_failed', suspended, {}, null, subscriptionAfterTrial()
        );

        assert.equal(resolved, null, 'a routine payment failure is not the trial\'s outcome');
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

        assert.equal(analytics.resolveEventId(resolved, order), 'subscription_renew.evt_september');
        assert.equal(
          analytics.resolveEventId(resolved, { id: '_test-order' }),
          'subscription_renew._test-order',
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

        // A trial is the one exception on this side: its outcome is keyed to the
        // SUBSCRIPTION, not the delivery, because two paths can be the one to see
        // it — this webhook, and the trial-lapse sweep when no webhook ever comes
        // (PayPal fires no trial-end event). One outcome must never be two
        // conversions, so both paths compute the same id.
        const converted = analytics.resolvePaymentEvent('subscription', null, 'invoice.payment_succeeded', subscriptionAfterTrial(), {}, null, subscriptionInTrial());
        assert.equal(analytics.resolveEventId(converted, order), 'trial_convert._test-sub-analytics');
        assert.equal(
          analytics.resolveEventId(converted, { id: '_other-order', metadata: { updatedBy: { event: { id: 'evt_october' } } } }),
          'trial_convert._test-sub-analytics',
          'a redelivery on another order id is still the same one conversion',
        );
      },
    },

    {
      // [#656]: `transaction_id` was the SUBSCRIPTION id, which never changes —
      // and GA4 deduplicates `purchase` on it
      // (https://support.google.com/analytics/answer/12313109), so it counted the
      // first charge of a subscription and dropped every renewal after it.
      name: 'two-renewals-of-one-subscription-are-two-transaction-ids',
      async run({ assert }) {
        const resolved = resolveRenewal('invoice.payment_succeeded');

        const september = analytics.buildParams({
          resolved, currency: 'USD', provider: 'stripe',
          order: { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_september' } } } },
          chargeId: 'in_september',
        });
        const october = analytics.buildParams({
          resolved, currency: 'USD', provider: 'stripe',
          order: { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_october' } } } },
          chargeId: 'in_october',
        });

        assert.equal(september.transaction_id, 'in_september', 'the invoice IS the charge');
        assert.equal(october.transaction_id, 'in_october');
        assert.notEqual(september.transaction_id, october.transaction_id, 'two charges are two transactions to GA4');
        assert.notEqual(september.transaction_id, '_test-sub-analytics', 'and neither is the subscription id');
      },
    },

    {
      // The one id both halves can compute. The confirmation page holds the order
      // id and nothing else, and GA4 collapses the two halves on it ([#656]).
      name: 'a-first-purchase-and-a-trial-start-name-the-order-the-browser-also-holds',
      async run({ assert }) {
        const order = { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_checkout' } } } };

        const firstPurchase = analytics.resolvePaymentEvent('subscription', 'new-subscription', 'customer.subscription.created', renewedSubscription(), {});
        assert.equal(
          analytics.buildParams({ resolved: firstPurchase, currency: 'USD', provider: 'stripe', order, chargeId: null }).transaction_id,
          '_test-order',
        );

        const trialStart = analytics.resolvePaymentEvent('subscription', 'new-subscription', 'customer.subscription.created', subscriptionInTrial(), {});
        assert.equal(trialStart.event, 'trial_start');
        assert.equal(
          analytics.buildParams({ resolved: trialStart, currency: 'USD', provider: 'stripe', order, chargeId: null }).transaction_id,
          '_test-order',
          'the trial checkout the browser half is about',
        );

        // A one-time buy has exactly one charge, and the order names it.
        const oneTime = analytics.resolvePaymentEvent('one-time', 'purchase-completed', 'checkout.session.completed', completedPurchase(), {});
        assert.equal(
          analytics.buildParams({ resolved: oneTime, currency: 'USD', provider: 'stripe', order, chargeId: null }).transaction_id,
          '_test-order',
        );
      },
    },

    {
      name: 'a-refund-names-the-charge-it-reverses-and-a-charge-event-never-falls-back-to-the-order',
      async run({ assert }) {
        const order = { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_september' } } } };

        const refund = analytics.resolvePaymentEvent('subscription', 'payment-refunded', 'charge.refunded', renewedSubscription(), {}, { amount: 9.99 });

        assert.equal(
          analytics.buildParams({ resolved: refund, currency: 'USD', provider: 'stripe', order, chargeId: 'in_september' }).transaction_id,
          'in_september',
          'GA4 nets a refund against the transaction id of the charge it reverses',
        );

        // No charge id in the payload: the WEBHOOK delivery, never the order —
        // the order is the collapse [#656] exists to undo.
        assert.equal(
          analytics.buildParams({ resolved: resolveRenewal('invoice.payment_succeeded'), currency: 'USD', provider: 'stripe', order, chargeId: null }).transaction_id,
          'evt_september',
        );
      },
    },

    {
      // A one-time order has exactly ONE charge, and no provider names it on the
      // refund — every one-time refund branch hands the pipeline a null chargeId.
      // So the refund names the ORDER, which is the id the purchase it reverses
      // was reported under, and GA4 nets the two ([#656]).
      name: 'a-one-time-refund-nets-against-the-purchase-it-reverses',
      async run({ assert }) {
        const order = { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_refund' } } } };

        const purchase = analytics.resolvePaymentEvent('one-time', 'purchase-completed', 'checkout.session.completed', completedPurchase(), {});
        const refund = analytics.resolvePaymentEvent(
          'one-time', 'purchase-refunded', 'charge.refunded', completedPurchase(), {},
          { amount: 99, currency: 'USD', reason: null }
        );

        const purchaseId = analytics.buildParams({ resolved: purchase, currency: 'USD', provider: 'stripe', order, chargeId: null }).transaction_id;
        const refundId = analytics.buildParams({ resolved: refund, currency: 'USD', provider: 'stripe', order, chargeId: null }).transaction_id;

        assert.equal(purchaseId, '_test-order');
        assert.equal(refundId, purchaseId, 'GA4 nets a one-time refund only if it names the same transaction');
        assert.notEqual(refundId, 'evt_refund', 'the refund webhook delivery would net against nothing');

        // A SUBSCRIPTION refund keeps the charge id: its renewals are separate
        // charges, so the order id would net October's reversal against the
        // first purchase.
        const renewalRefund = analytics.resolvePaymentEvent(
          'subscription', 'payment-refunded', 'charge.refunded', renewedSubscription(), {},
          { amount: 9.99, currency: 'USD', reason: null }
        );

        assert.equal(
          analytics.buildParams({ resolved: renewalRefund, currency: 'USD', provider: 'stripe', order, chargeId: 'in_october' }).transaction_id,
          'in_october',
        );
      },
    },

    {
      // The outcomes that are NOT charges keep naming their subject: each is a
      // GA4 custom event with no dedupe of its own.
      name: 'the-events-that-are-not-charges-still-name-the-subscription',
      async run({ assert }) {
        const order = { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_cancel' } } } };
        const cancelled = { ...renewedSubscription(), status: 'cancelled' };

        const resolved = analytics.resolvePaymentEvent('subscription', 'subscription-cancelled', 'customer.subscription.deleted', cancelled, {}, null, renewedSubscription());

        assert.equal(resolved.event, 'subscription_cancel');
        assert.equal(
          analytics.buildParams({ resolved, currency: 'USD', provider: 'stripe', order, chargeId: null }).transaction_id,
          '_test-sub-analytics',
        );
      },
    },

    {
      // Every provider has to hand the pipeline an id for the charge, or the
      // renewal branch above has nothing to key on ([#656]).
      name: 'every-provider-exposes-its-own-per-charge-id-on-the-parsed-event',
      async run({ assert }) {
        const stripe = stripeProvider.parseWebhook({
          body: {
            id: 'evt_stripe',
            type: 'invoice.payment_succeeded',
            data: { object: { id: 'in_september', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_1', metadata: { uid: 'u1' } } } } },
          },
        });

        assert.equal(stripe.resourceId, 'sub_1', 'the resource is still the subscription to fetch');
        assert.equal(stripe.chargeId, 'in_september', 'and the invoice is the charge');

        const paypal = paypalProvider.parseWebhook({
          body: {
            id: 'WH-paypal',
            event_type: 'PAYMENT.SALE.COMPLETED',
            resource: { id: 'SALE-september', billing_agreement_id: 'I-1', custom_id: 'uid:u1' },
          },
        });

        assert.equal(paypal.resourceId, 'I-1', 'the billing agreement is the subscription');
        assert.equal(paypal.chargeId, 'SALE-september', 'and the sale is the charge');

        const chargebee = chargebeeProvider.parseWebhook({
          body: {
            id: 'ev_chargebee',
            event_type: 'subscription_renewed',
            content: { subscription: { id: 'cb_sub_1' }, invoice: { id: 'inv_september' } },
          },
        });

        assert.equal(chargebee.resourceId, 'cb_sub_1');
        assert.equal(chargebee.chargeId, 'inv_september', 'Chargebee names the renewal invoice');

        // ONLY the renewal's. A `subscription_created` payload carries the
        // checkout's first invoice (test/fixtures/chargebee/webhook-subscription-created.json),
        // and that charge is the ORDER's — the id the browser half sends too.
        const chargebeeCreated = chargebeeProvider.parseWebhook({
          body: {
            id: 'ev_created',
            event_type: 'subscription_created',
            content: { subscription: { id: 'cb_sub_1' }, invoice: { id: 'inv_first' } },
          },
        });

        assert.equal(chargebeeCreated.chargeId, null, 'a first charge is the order\'s, never the invoice\'s');

        // The test provider IS Stripe's parser, so it carries the same id.
        assert.equal(testProvider.parseWebhook({
          body: {
            id: 'evt_test',
            type: 'invoice.payment_succeeded',
            data: { object: { id: 'in_test', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_1' } } } },
          },
        }).chargeId, 'in_test');

        // A subscription's lifecycle events name no charge at all — the first
        // purchase is the order's, and that is the branch that must not guess.
        assert.equal(stripeProvider.parseWebhook({
          body: { id: 'evt_created', type: 'customer.subscription.created', data: { object: { id: 'sub_1', metadata: { uid: 'u1' } } } },
        }).chargeId, null);
      },
    },

    {
      // [#654]: the confirmation page fired `purchase` for a TRIAL checkout while
      // this fired `trial_start`. Different event names never deduplicate, so a $0
      // trial produced a browser Purchase carrying the plan's price beside the
      // server's StartTrial. Both halves now say trial_start, keyed on the order —
      // the only id a browser can compute.
      name: 'a-trial-start-keys-its-dedupe-id-on-the-order-like-its-browser-twin',
      async run({ assert }) {
        const order = { id: '_test-order', metadata: { updatedBy: { event: { id: 'evt_checkout' } } } };

        const trialStart = analytics.resolvePaymentEvent('subscription', 'new-subscription', 'customer.subscription.created', subscriptionInTrial(), {});

        assert.equal(trialStart.event, 'trial_start');
        assert.equal(analytics.resolveEventId(trialStart, order), 'trial_start._test-order', 'the id the confirmation page will send');
        assert.notEqual(
          analytics.resolveEventId(trialStart, order),
          'trial_start.evt_checkout',
          'the webhook delivery is not derivable in a browser, so it can never key a two-sided event',
        );
      },
    },
  ],
};
