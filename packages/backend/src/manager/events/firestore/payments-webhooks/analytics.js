const discountCodes = require('../../../libraries/payment/discount-codes.js');
const isTrialing = require('../../../routes/payments/cancel/_is-trialing.js');
const { deliverConversion } = require('../../../libraries/analytics/conversions.js');
const { buildAttributionContext, buildIdentity } = require('../../../libraries/analytics/match-data.js');

/**
 * Payment analytics tracking
 *
 * The webhook decides WHAT happened; `@omega.js/analytics`' catalog decides what
 * each platform calls it and what shape it takes
 * ([#385](https://github.com/Omega-JS-Stack/omega/issues/385)). So this file maps
 * a transition to a CANONICAL event name plus canonical params, and hands both to
 * the conversion delivery library — which walks the adapters and the three
 * platform APIs. No provider dialect lives here any more.
 *
 * Two independent concerns:
 *   1. Transition events (mutually exclusive, one per webhook):
 *      new-subscription (no trial)            → purchase
 *      new-subscription (trial)               → trial_start
 *      subscription-winback                   → purchase
 *      payment-recovered                      → payment_recovered
 *      subscription-cancelled (paid)          → subscription_cancel
 *      subscription-cancelled (in trial)      → trial_lapse
 *      subscription-cancelled (after a lapse) → nothing
 *      cancellation-removed                   → subscription_uncancel
 *      plan-changed                           → subscription_plan_change
 *      payment-failed (in trial)              → trial_lapse
 *      payment-refunded                       → refund
 *      purchase-completed                     → purchase (one-time)
 *      purchase-refunded                      → refund (one-time)
 *
 *   2. Payment events (fire whenever money changes hands, including renewals):
 *      first charge after a trial  → trial_convert
 *      subscription renewal        → subscription_renew
 *
 * ONE LIMIT OF THE TRIAL EVENTS, deliberate. This resolver reads the subscription's
 * TERM, never an invoice amount (the same reason PayPal's transform refuses to read
 * the payment record — a day-zero setup fee exists during a trial and is not a
 * billing period, docs/payment-system.md), so a real charge taken INSIDE the trial
 * term books nothing at all.
 *
 * `trial_lapse` covers EVERY way a trial ends without paying, in whatever shape the
 * provider announces it: the failed charge that suspends the subscription, and the
 * cancellation that ends it outright. Chargebee cancels a trial with no card on
 * file, and a subscriber on any provider may simply quit mid-trial. The check reads
 * the unified term, never a provider name, so the two arrive as one story
 * ([#414](https://github.com/Omega-JS-Stack/omega/issues/414)). And a trial that
 * already lapsed is not told twice: the cancellation that ends a dunning suspension
 * whose trial never converted books nothing, because the decline that suspended it
 * already reported the outcome.
 *
 * Which leaves `subscription_cancel` to the cancellations a trial does not
 * explain: a subscriber who left their trial behind, and one who never had a trial
 * at all. It is no longer where a never-paid trialist lands, which is the claim this
 * file can actually stand behind.
 *
 * This file covers the outcomes a PROVIDER announces. The ones it never announces
 * — most of all PayPal's, which fires no trial-end event at all — are reported by
 * the daily trial-lapse sweep (`events/cron/daily/trial-lapse-sweep.js`) at the
 * moment it stamps `trial.outcome`, through the same delivery path and keyed on the
 * same subscription-scoped event id, so the two can never both report one outcome.
 *
 * `cancellation-requested` stays deliberately event-less: a schedule changed,
 * nothing ended and no money moved — the subscription is still active and may
 * never cancel at all. Its WITHDRAWAL is not the mirror image of that, which is
 * why the pair is not symmetric: keeping a subscriber is an outcome
 * ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)).
 *
 * A `payment-failed` outside a trial stays event-less too: the provider is still
 * retrying, and dunning is not yet an outcome. Only `subscription-cancelled` and
 * `payment-recovered` say how it ended.
 */

/**
 * Track payment events across analytics platforms (non-blocking)
 *
 * @param {object} options
 * @param {string} options.category - 'subscription' | 'one-time'
 * @param {string|null} options.transitionName - The detected transition
 * @param {string} options.eventType - The provider's webhook event name
 * @param {object} options.unified - The unified subscription/purchase object
 * @param {object} options.order - The order doc about to be written (attribution, request, consent)
 * @param {object} [options.userDoc] - The owner's user doc — the email/phone the match data hashes
 * @param {object|null} [options.refundDetails] - The library's { amount, currency, reason }
 * @param {object|null} [options.before] - The subscription as it stood BEFORE this event
 * @param {string} options.uid - The owner
 * @param {string} options.provider - The provider that sent the webhook
 * @param {string|null} [options.chargeId] - THIS charge's own provider id, where the
 *   event names one (Stripe/Chargebee invoice, PayPal sale) — the id one charge is
 *   reported under ([#656](https://github.com/Omega-JS-Stack/omega/issues/656))
 * @param {object} options.ctx - The event context
 */
function trackPayment({ category, transitionName, eventType, unified, order, userDoc, refundDetails, before, uid, provider, chargeId, ctx }) {
  const Manager = ctx.Manager;
  const config = Manager.config;

  try {
    // Resolve what kind of payment event this is
    const resolved = resolvePaymentEvent(category, transitionName, eventType, unified, order, refundDetails, before);

    if (!resolved) {
      ctx.log(`trackPayment: skipped — no trackable event (category=${category}, transition=${transitionName || 'null'}, eventType=${eventType})`);
      return;
    }

    const currency = config.payment?.currency || 'USD';

    ctx.log(`trackPayment: event=${resolved.event}, reason=${resolved.reason}, value=${resolved.value}, currency=${currency}, product=${resolved.productId}, uid=${uid}, provider=${provider}`);

    deliverConversion({
      event: resolved.event,
      params: buildParams({ resolved, currency, provider, order, chargeId }),
      attribution: buildAttributionContext(order?.attribution),
      // The doc goes in whole: the ONE reader takes every match parameter off
      // it, so this call site never decides which key an address lives under
      // ([#577](https://github.com/Omega-JS-Stack/omega/issues/577)).
      identity: buildIdentity({
        uid,
        user: userDoc,
        request: order?.request,
      }),
      trackingConsent: order?.trackingConsent,
      eventId: resolveEventId(resolved, order),
      ctx,
      Manager,
    });
  } catch (e) {
    ctx.error(`trackPayment failed: ${e.message}`, e);
  }
}

/**
 * The canonical commerce params every money event carries.
 * GA4's vocabulary IS the canonical one; Meta and TikTok reshape it in the catalog.
 */
function buildParams({ resolved, currency, provider, order, chargeId }) {
  return {
    transaction_id: resolveTransactionId({ resolved, order, chargeId }),
    value: resolved.value,
    currency: currency,
    items: [{
      item_id: resolved.productId,
      item_name: resolved.productName,
      price: resolved.value,
      quantity: 1,
    }],
    payment_provider: provider,
    payment_frequency: resolved.frequency,
    is_trial: resolved.isTrial,
    is_recurring: resolved.isRecurring,
    // The plan a switch came FROM — only a plan change has one, and `items` above
    // is always the plan they moved TO
    // ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)).
    ...(resolved.previous ? {
      previous_item_id: resolved.previous.productId,
      previous_item_name: resolved.previous.productName,
      previous_value: resolved.previous.value,
    } : {}),
  };
}

// The money events with a BROWSER half. Both halves can only ever agree on the
// ORDER — the browser holds nothing else — and both are the FIRST charge of that
// order, so the order id names exactly one charge here.
const ORDER_KEYED_EVENTS = ['purchase', 'trial_start'];

// The events that report a charge the ORDER cannot name: a subscription bills
// again and again against one order, so each of these carries the provider's own
// id for the charge it is about.
const CHARGE_KEYED_EVENTS = ['trial_convert', 'subscription_renew', 'payment_recovered', 'refund'];

/**
 * The `transaction_id` this fire carries — ONE id per CHARGE, never the
 * subscription's (Ian 2026-08-27,
 * [#656](https://github.com/Omega-JS-Stack/omega/issues/656)).
 *
 * GA4 deduplicates `purchase` on `transaction_id`
 * (https://support.google.com/analytics/answer/12313109), and `trial_convert`,
 * `subscription_renew` and `payment_recovered` all ride GA4's standard
 * `purchase`. The subscription id this used to send is CONSTANT for the life of
 * the subscription, so GA4 counted the first charge and dropped every renewal
 * after it as a duplicate: recurring revenue read as one charge per subscriber.
 *
 * So the id is the charge's:
 *   - first purchase (a paid checkout, a one-time buy, or a trial start) — the
 *     ORDER id, which the confirmation page holds too, so the browser half and
 *     the webhook half deduplicate into one purchase instead of two;
 *   - renewal, recovery and trial conversion — the provider's own id for that
 *     charge (Stripe/Chargebee invoice, PayPal sale);
 *   - refund — the id of the charge it reverses, so GA4 nets the two.
 *
 * A ONE-TIME refund is the exception to that last line: a one-time order has
 * exactly ONE charge, the purchase it reverses was reported under the order id,
 * and no provider names a charge on its one-time refund at all — so it names the
 * order and GA4 nets the two. Only one-time: a subscription bills again and
 * again against one order, so an order-keyed refund would net a renewal's
 * reversal against the first purchase.
 *
 * A charge event whose payload names no charge id falls back to the WEBHOOK
 * delivery, never to the order: the delivery is unique per charge, and the order
 * is the collapse this fixes. THE ONE KNOWN GAP: a refund of a SUBSCRIPTION's
 * first charge names that first invoice, while the purchase it reverses was
 * recorded under the order id — nothing in the refund payload can tell a first
 * invoice from a renewal's, so GA4 books the refund without netting it.
 *
 * Everything else (a cancellation, an uncancel, a plan change, a lapsed trial)
 * is a GA4 CUSTOM event with no dedupe of its own, and its subject really is the
 * subscription — so those keep naming it.
 *
 * @param {object} options
 * @param {object} options.resolved - The resolved payment event
 * @param {object} [options.order] - The order doc this event is about
 * @param {string|null} [options.chargeId] - The provider's id for this charge
 * @returns {string|undefined}
 */
function resolveTransactionId({ resolved, order, chargeId }) {
  if (ORDER_KEYED_EVENTS.includes(resolved.event)) {
    return order?.id || resolved.resourceId;
  }

  if (CHARGE_KEYED_EVENTS.includes(resolved.event)) {
    // The one-time refund: the order names the single charge it reverses, and
    // that purchase was reported under the order id.
    if (resolved.event === 'refund' && resolved.category === 'one-time') {
      return order?.id || resolved.resourceId;
    }

    return chargeId || order?.metadata?.updatedBy?.event?.id || resolved.resourceId;
  }

  return resolved.resourceId;
}

/**
 * The platform dedupe id for this fire.
 *
 * `purchase` and `trial_start` are keyed on the ORDER, because they are the
 * payment events with a BROWSER twin: the confirmation page fires its own pixel
 * ([#386]) and the only id it can possibly compute is `<canonical>.<orderId>` —
 * the webhook's event id never reaches a browser. Two different ids for one
 * conversion is a double count, which is the whole thing dedupe exists to
 * prevent. `trial_start` joined this branch with
 * [#654](https://github.com/Omega-JS-Stack/omega/issues/654): the browser used
 * to fire `purchase` for a trial checkout while this fired `trial_start`, and
 * two different event NAMES never deduplicate at all, so a $0 trial booked the
 * plan's price as browser revenue. Both halves now say trial_start, and the
 * webhook-delivery fallback that used to key this is gone — a browser cannot
 * derive it. Reusing an order id is safe: Meta's and TikTok's dedupe windows are
 * ~48h, and the only way one order sees a second purchase is a win-back weeks or
 * months later, long outside any window.
 *
 * Everything else keys on the WEBHOOK delivery. A subscription renews against
 * the same order id month after month, so an order-keyed id would have the
 * platforms discard every renewal after the first as a duplicate — and none of
 * these events has a browser twin to match anyway. A redelivery of the SAME
 * webhook carries the same id, which is exactly what dedupe is for.
 */
function resolveEventId(resolved, order) {
  if (ORDER_KEYED_EVENTS.includes(resolved.event)) {
    return `${resolved.event}.${order?.id}`;
  }

  // A trial has exactly ONE outcome, and two different paths can be the one to see
  // it: this webhook when the provider announces it, and the trial-lapse sweep
  // when no webhook ever comes (PayPal fires no trial-end event at all). Keying
  // both on the SUBSCRIPTION means a race between them is one conversion to every
  // platform that deduplicates, never two
  // ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)).
  if (resolved.event === 'trial_convert' || resolved.event === 'trial_lapse') {
    return `${resolved.event}.${resolved.resourceId}`;
  }

  return `${resolved.event}.${order?.metadata?.updatedBy?.event?.id || order?.id}`;
}

// ---------------------------------------------------------------------------
// Event resolution
// ---------------------------------------------------------------------------

/**
 * Determine what kind of payment event occurred and extract common fields
 *
 * Returns null if nothing should be tracked. `event` is the canonical catalog
 * name; `reason` is the finer-grained why, which several canonical names share
 * (three different reasons are all a `purchase`) and which the logs read.
 *
 * @param {string} category - 'subscription' | 'one-time'
 * @param {string|null} transitionName - The detected transition
 * @param {string} eventType - The provider's webhook event name
 * @param {object} unified - The unified subscription/purchase object
 * @param {object} order - The order doc
 * @param {object|null} [refundDetails] - The library's { amount, currency, reason }
 * @param {object|null} [before] - The subscription as it stood BEFORE this event
 * @returns {object|null}
 */
function resolvePaymentEvent(category, transitionName, eventType, unified, order, refundDetails, before) {
  const productId = unified.product?.id;
  const productName = unified.product?.name;
  const frequency = unified.payment?.frequency || null;
  const isTrial = unified.trial?.claimed === true;
  const resourceId = unified.payment?.resourceId;
  const price = parseFloat(unified.payment?.price || 0);

  // Compute actual amount paid (accounting for trial and discount)
  const value = resolveActualValue(price, isTrial, order?.discount);

  // `category` rides along: a refund's transaction id turns on it (a one-time
  // order names one charge, a subscription names many —
  // [#656](https://github.com/Omega-JS-Stack/omega/issues/656)).
  const base = { category, productId, productName, frequency, resourceId, isTrial };

  // --- Refunds (both categories) ---
  // Detected off the TRANSITION rather than the event type, so the transition
  // layer's redelivery guard covers this too: a webhook doc that already
  // completed once detects no transition, and reports no second refund.
  if (transitionName === 'payment-refunded' || transitionName === 'purchase-refunded') {
    return {
      ...base,
      event: 'refund',
      reason: 'refund',
      // What actually went back to the customer — the provider's own number,
      // and only the price as a last resort (a partial refund reported as the
      // full price would overstate the reversal).
      value: resolveRefundValue(refundDetails, unified, price),
      isRecurring: false,
    };
  }

  // --- Subscription transitions ---
  if (category === 'subscription') {
    if (transitionName === 'new-subscription' && isTrial) {
      return { ...base, event: 'trial_start', reason: 'trial-started', value: 0, isRecurring: false };
    }

    if (transitionName === 'new-subscription') {
      return { ...base, event: 'purchase', reason: 'first-purchase', value, isRecurring: false };
    }

    // A win-back is a returning customer buying again — a purchase, at what they
    // actually paid. Its checkout arrives on a payment event, so without this the
    // renewal branch below claimed it and reported recurring revenue ([#218]).
    if (transitionName === 'subscription-winback') {
      return { ...base, event: 'purchase', reason: 'winback-purchase', value, isRecurring: false };
    }

    if (transitionName === 'payment-recovered') {
      return { ...base, event: 'payment_recovered', reason: 'payment-recovered', value: price, isRecurring: true };
    }

    // The cancellation that TOOK EFFECT. No money moves, so it is not recurring
    // revenue — the value is the subscription's price, which is what the churn
    // cost, and what an ad platform optimizing away from churn needs to see.
    //
    // Inside the trial term it is no churn at all: nobody who never paid can be lost
    // revenue. It is the trial's own outcome, and it reaches here on every provider.
    // Chargebee ends a no-card trial by cancelling it (booked as paid churn until
    // [#414]), and a Stripe or PayPal subscriber may simply quit mid-trial. The PRIOR
    // state's term is what says which of the two this is, exactly as it does for the
    // payment-failed lapse below.
    //
    // Except the prior state is a stored DELIVERY, and a degraded one carries no term
    // (see `isInsideTrial`), which reads as a trial this subscriber left long ago. So
    // the cancelled payload's own evidence overrules it: a term that outlived the
    // trial's end belongs to somebody who paid, whatever the record on file lost.
    //
    // And a trial that already lapsed says nothing a second time. The provider
    // suspends the subscription at the failed charge (reported there, as the lapse),
    // then exhausts dunning and cancels what it was holding: one outcome, two
    // webhooks, and booking this one too put paid-churn revenue and an ad-platform
    // audience signal behind a customer who never paid.
    if (transitionName === 'subscription-cancelled') {
      const outlived = outlivedItsTrial(unified, before);

      if (!outlived && isInsideTrial(before)) {
        return { ...base, event: 'trial_lapse', reason: 'trial-cancelled', value: price, isRecurring: false };
      }

      if (!outlived && isLapsedTrialSuspension(before)) {
        return null;
      }

      return { ...base, event: 'subscription_cancel', reason: 'subscription-cancelled', value: price, isRecurring: false };
    }

    // The scheduled cancellation the subscriber took back. No money moves, so the
    // value is the subscription that was KEPT — what the retention win is worth,
    // and the mirror of the churn number the cancellation above reports.
    if (transitionName === 'cancellation-removed') {
      return { ...base, event: 'subscription_uncancel', reason: 'cancellation-removed', value: price, isRecurring: false };
    }

    // An upgrade or a downgrade. No money moves at the switch itself (the
    // provider prorates on its own schedule), so the value is what the customer
    // now pays — and the plan they came from rides along, which is the only way
    // the direction is readable without a second event.
    if (transitionName === 'plan-changed') {
      return {
        ...base,
        event: 'subscription_plan_change',
        reason: 'plan-changed',
        value: price,
        isRecurring: false,
        previous: {
          productId: before?.product?.id || null,
          productName: before?.product?.name || null,
          value: parseFloat(before?.payment?.price || 0),
        },
      };
    }

    // The trial that ended without ever paying. It has the same active → suspended
    // shape a routine dunning failure has, so the PRIOR state is what tells them
    // apart: only a subscription still inside its trial had been charged nothing at
    // all. The value is the subscription that never started paying.
    if (transitionName === 'payment-failed' && isInsideTrial(before)) {
      return { ...base, event: 'trial_lapse', reason: 'trial-lapsed', value: price, isRecurring: false };
    }

    // The first REAL charge after a trial. It arrives exactly like a renewal — no
    // transition, a payment event — so before [#407] it was reported as one, and
    // the funnel's most valuable step was indistinguishable from month two.
    //
    // The trial has to be LEFT for this to be the conversion, which is also what
    // declines the $0 trial-START invoice: that one carries no transition either,
    // but the subscription is inside its trial on both sides of it, so nothing was
    // converted and nothing was charged.
    if (!transitionName && isPaymentEvent(eventType) && price > 0 && isInsideTrial(before) && !isInsideTrial(unified, before)) {
      return {
        ...base,
        event: 'trial_convert',
        reason: 'trial-converted',
        // A checkout discount lands on exactly this invoice — the trial's own $0
        // is behind us, so this is the one charge it can apply to.
        value: resolveActualValue(price, false, order?.discount),
        isRecurring: false,
      };
    }

    // No transition but a payment event fired (renewal)
    // Renewals always use full price (discount is one-time only)
    //
    // A subscription still INSIDE its trial is never renewing: the trial-start
    // invoice is a payment event for $0, and this branch reads the PLAN price, so
    // it booked a full month of revenue for an invoice that charged nothing
    // ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)). A real renewal
    // is outside the trial by definition, so the clause cannot touch one. Which is
    // why the payload it reads is weighed against the term the subscription already
    // had ([#414]): a thin delivery must not read as a trial and swallow a renewal.
    if (!transitionName && isPaymentEvent(eventType) && price > 0 && !isInsideTrial(unified, before)) {
      return { ...base, event: 'subscription_renew', reason: 'renewal', value: price, isRecurring: true };
    }

    return null;
  }

  // --- One-time transitions ---
  if (category === 'one-time') {
    if (transitionName === 'purchase-completed') {
      return { ...base, event: 'purchase', reason: 'one-time-purchase', value, isRecurring: false, productId: productId || 'unknown', productName: productName || 'Unknown' };
    }

    return null;
  }

  return null;
}

/**
 * Is this subscription still INSIDE its free trial, for reporting purposes?
 *
 * `trial.claimed` only ever means "this subscription HAD a trial" — it stays true
 * for the life of the subscription (the trial-lapse sweep exists for exactly that
 * reason), so on its own it can never tell a trial's own outcome from a renewal or
 * a dunning failure months later. "Still inside the trial" has ONE definition,
 * `routes/payments/cancel/_is-trialing.js`, and this DELEGATES to it rather than
 * keeping a second copy of the comparison.
 *
 * The one widening, and only here: Chargebee's in-trial payload names no
 * `current_term_end` at all, so `expires` folds to the epoch and the timestamp
 * match cannot see the trial — every Chargebee conversion read as a renewal and
 * every Chargebee lapse reported nothing
 * ([#407](https://github.com/Omega-JS-Stack/omega/issues/407)). An epoch expiry is
 * the ABSENCE of a term, never a term that ended in 1970, so a claimed trial with a
 * real trial expiry and no term at all is still a trial.
 *
 * That widening stays OUT of the shared predicate on purpose: it also waives the
 * cancel route's 24-hour guard, and a guard must never be waived by missing data
 * ([#267](https://github.com/Omega-JS-Stack/omega/issues/267)). Reporting has no
 * such stake — the worst case is a funnel number, not an unguarded cancellation.
 *
 * And the widening is BOUNDED by the state the subscription arrived from, when the
 * caller has one. A degraded payload carries no term either: the stale fallback
 * hands over the webhook's own body when the provider API is unreachable
 * ([#222](https://github.com/Omega-JS-Stack/omega/issues/222)), and an active PAID
 * subscription in that body is shaped exactly like a Chargebee trial, with the same
 * claimed trial and the same epoch expiry. Nothing in the payload can tell them
 * apart, so the PRIOR state does: a subscription already paid through a real term
 * did not lose that term by trialing, so a term missing THERE is a hole in the
 * delivery, not the absence of a term. Unbounded, a renewal on that path matched no
 * branch at all and booked nothing: real revenue, silently unreported
 * ([#414](https://github.com/Omega-JS-Stack/omega/issues/414)).
 *
 * The bound needs one HEALTHY delivery behind it, which is its limit: two degraded
 * deliveries in a row leave no term on either side, so that renewal still books
 * nothing. Narrower than the hole it closes, and it fails toward silence rather than
 * toward a fabricated number.
 *
 * @param {object|null} [subscription] - A subscription object
 * @param {object|null} [before] - The state it arrived FROM, when the question is
 *   about a payload a provider just delivered. Omitted, the widening is unbounded,
 *   which is what the trial-lapse sweep wants: it asks about a STORED subscription,
 *   which has no delivery behind it to be degraded.
 * @returns {boolean}
 */
function isInsideTrial(subscription, before) {
  if (isTrialing(subscription)) {
    return true;
  }

  if (before?.expires?.timestampUNIX) {
    return false;
  }

  return !!(subscription?.trial?.claimed
    && subscription?.status === 'active'
    && subscription?.trial?.expires?.timestampUNIX
    && !subscription?.expires?.timestampUNIX);
}

/**
 * Does the payload in hand PROVE this subscription outlived its trial?
 *
 * The trial rules read the prior state, and the prior state is a stored delivery
 * like any other, and a degraded one lost its term, which reads as a trial
 * ([#414](https://github.com/Omega-JS-Stack/omega/issues/414)). This is the evidence
 * that overrules it, taken from the payload the provider just sent: a term reaching
 * PAST the trial's end can only have been paid for. It says nothing when either date
 * is missing, which is the honest answer: an absent term proves nothing either way.
 *
 * A cancelled trial never trips it, on any provider: Stripe cancels one with the
 * period still set to the trial's own end (equal, not past), and Chargebee cancels
 * one with no term at all (`test/fixtures/chargebee/subscription-in-trial.json`).
 *
 * @param {object|null} [subscription] - The payload the provider just delivered
 * @param {object|null} [before] - The state it arrived FROM
 * @returns {boolean}
 */
function outlivedItsTrial(subscription, before) {
  const trialExpires = before?.trial?.expires?.timestampUNIX;
  const expires = subscription?.expires?.timestampUNIX;

  return !!(trialExpires && expires && expires > trialExpires);
}

/**
 * Is this the suspension a LAPSED trial leaves behind?
 *
 * A trial that never converted and a subscriber who paid for months land in the same
 * `suspended` state, and the term tells them apart exactly the way it does for a live
 * subscription: a trial that never converted never moved its term past the trial's
 * end, and a Chargebee one never had a term at all.
 *
 * This is not `isInsideTrial` with another status: that one answers "is the trial
 * still running", delegates to the cancel flow's shared predicate for it, and is read
 * by the trial-lapse sweep. This answers "did the trial end unpaid, and has the
 * provider been sitting on it since" — which is the question a cancellation arriving
 * after dunning asks ([#414](https://github.com/Omega-JS-Stack/omega/issues/414)).
 *
 * @param {object|null} [subscription] - A subscription object
 * @returns {boolean}
 */
function isLapsedTrialSuspension(subscription) {
  const trialExpires = subscription?.trial?.expires?.timestampUNIX;
  const expires = subscription?.expires?.timestampUNIX;

  return !!(subscription?.status === 'suspended'
    && subscription?.trial?.claimed
    && trialExpires
    && (expires === trialExpires || !expires));
}

/**
 * Compute the actual amount paid, accounting for trial and promo discount
 * Trial = $0, discount = price - savings, otherwise full price
 */
function resolveActualValue(price, isTrial, discount) {
  if (isTrial) {
    return 0;
  }

  // Both coupon shapes count — gating on `percent` alone reported the LIST price
  // as revenue for an amount-based code while the customer paid less
  if (discount?.valid === true) {
    return discountCodes.applyToAmount(price, discount);
  }

  return price;
}

/**
 * What a refund actually reversed: the provider's amount, then the amount the
 * order fold already recorded, then the price as the last resort.
 */
function resolveRefundValue(refundDetails, unified, price) {
  const amount = refundDetails?.amount ?? unified.payment?.refund?.amount;

  return amount === null || amount === undefined ? price : parseFloat(amount);
}

/**
 * Check if a webhook event type represents a payment being made
 */
function isPaymentEvent(eventType) {
  if (!eventType) {
    return false;
  }

  return [
    // PayPal
    'PAYMENT.SALE.COMPLETED',
    // Stripe
    'invoice.payment_succeeded',
    'invoice.paid',
    // Chargebee — the renewal event its webhook parser reports for a recurring charge
    'subscription_renewed',
  ].includes(eventType);
}

module.exports = {
  trackPayment,
  // The trial-lapse sweep reports the outcomes no webhook ever announces, and both
  // paths have to agree on what "still inside the trial" means ([#407]).
  isInsideTrial,
  // Exported for testing
  resolvePaymentEvent,
  isPaymentEvent,
  buildParams,
  resolveTransactionId,
  resolveEventId,
};
