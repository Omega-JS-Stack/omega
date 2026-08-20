const discountCodes = require('../../../libraries/payment/discount-codes.js');
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
 *      new-subscription (no trial) → purchase
 *      new-subscription (trial)    → start_trial
 *      subscription-winback        → purchase
 *      payment-recovered           → payment_recovered
 *      subscription-cancelled      → subscription_cancelled
 *      payment-refunded            → refund
 *      purchase-completed          → purchase (one-time)
 *      purchase-refunded           → refund (one-time)
 *
 *   2. Payment events (fire whenever money changes hands, including renewals):
 *      subscription renewal        → subscription_renewed
 *
 * The two cancellation SCHEDULE transitions (`cancellation-requested`,
 * `cancellation-removed`) stay deliberately unmapped: nothing ended and no money
 * moved — the subscription is still active and may never cancel at all. Only the
 * cancellation that actually took effect is a conversion event.
 */

/**
 * Track payment events across analytics platforms (non-blocking)
 *
 * @param {object} options
 * @param {string} options.category - 'subscription' | 'one-time'
 * @param {string|null} options.transitionName - The detected transition
 * @param {string} options.eventType - The processor's webhook event name
 * @param {object} options.unified - The unified subscription/purchase object
 * @param {object} options.order - The order doc about to be written (attribution, request, consent)
 * @param {object} [options.userDoc] - The owner's user doc — the email/phone the match data hashes
 * @param {object|null} [options.refundDetails] - The library's { amount, currency, reason }
 * @param {string} options.uid - The owner
 * @param {string} options.processor - The processor that sent the webhook
 * @param {object} options.ctx - The event context
 */
function trackPayment({ category, transitionName, eventType, unified, order, userDoc, refundDetails, uid, processor, ctx }) {
  const Manager = ctx.Manager;
  const config = Manager.config;

  try {
    // Resolve what kind of payment event this is
    const resolved = resolvePaymentEvent(category, transitionName, eventType, unified, order, refundDetails);

    if (!resolved) {
      ctx.log(`trackPayment: skipped — no trackable event (category=${category}, transition=${transitionName || 'null'}, eventType=${eventType})`);
      return;
    }

    const currency = config.payment?.currency || 'USD';

    ctx.log(`trackPayment: event=${resolved.event}, reason=${resolved.reason}, value=${resolved.value}, currency=${currency}, product=${resolved.productId}, uid=${uid}, processor=${processor}`);

    deliverConversion({
      event: resolved.event,
      params: buildParams({ resolved, currency, processor }),
      attribution: buildAttributionContext(order?.attribution),
      identity: buildIdentity({
        uid,
        email: userDoc?.auth?.email,
        telephone: userDoc?.personal?.telephone,
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
function buildParams({ resolved, currency, processor }) {
  return {
    transaction_id: resolved.resourceId,
    value: resolved.value,
    currency: currency,
    items: [{
      item_id: resolved.productId,
      item_name: resolved.productName,
      price: resolved.value,
      quantity: 1,
    }],
    payment_processor: processor,
    payment_frequency: resolved.frequency,
    is_trial: resolved.isTrial,
    is_recurring: resolved.isRecurring,
  };
}

/**
 * The platform dedupe id for this fire.
 *
 * `purchase` is keyed on the ORDER, because it is the one payment event with a
 * BROWSER twin: the confirmation page fires its own purchase pixel ([#386]) and
 * the only id it can possibly compute is `purchase.<orderId>` — the webhook's
 * event id never reaches a browser. Two different ids for the one purchase is a
 * double count, which is the whole thing dedupe exists to prevent. Reusing an
 * order id is safe here: Meta's and TikTok's dedupe windows are ~48h, and the
 * only way one order sees a second `purchase` is a win-back weeks or months
 * later, long outside any window.
 *
 * Everything else keys on the WEBHOOK delivery. A subscription renews against
 * the same order id month after month, so an order-keyed id would have the
 * platforms discard every renewal after the first as a duplicate — and none of
 * these events has a browser twin to match anyway. A redelivery of the SAME
 * webhook carries the same id, which is exactly what dedupe is for.
 */
function resolveEventId(resolved, order) {
  if (resolved.event === 'purchase') {
    return `purchase.${order?.id}`;
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
 * @param {string} eventType - The processor's webhook event name
 * @param {object} unified - The unified subscription/purchase object
 * @param {object} order - The order doc
 * @param {object|null} [refundDetails] - The library's { amount, currency, reason }
 * @returns {object|null}
 */
function resolvePaymentEvent(category, transitionName, eventType, unified, order, refundDetails) {
  const productId = unified.product?.id;
  const productName = unified.product?.name;
  const frequency = unified.payment?.frequency || null;
  const isTrial = unified.trial?.claimed === true;
  const resourceId = unified.payment?.resourceId;
  const price = parseFloat(unified.payment?.price || 0);

  // Compute actual amount paid (accounting for trial and discount)
  const value = resolveActualValue(price, isTrial, order?.discount);

  const base = { productId, productName, frequency, resourceId, isTrial };

  // --- Refunds (both categories) ---
  // Detected off the TRANSITION rather than the event type, so the transition
  // layer's redelivery guard covers this too: a webhook doc that already
  // completed once detects no transition, and reports no second refund.
  if (transitionName === 'payment-refunded' || transitionName === 'purchase-refunded') {
    return {
      ...base,
      event: 'refund',
      reason: 'refund',
      // What actually went back to the customer — the processor's own number,
      // and only the price as a last resort (a partial refund reported as the
      // full price would overstate the reversal).
      value: resolveRefundValue(refundDetails, unified, price),
      isRecurring: false,
    };
  }

  // --- Subscription transitions ---
  if (category === 'subscription') {
    if (transitionName === 'new-subscription' && isTrial) {
      return { ...base, event: 'start_trial', reason: 'trial-started', value: 0, isRecurring: false };
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
    if (transitionName === 'subscription-cancelled') {
      return { ...base, event: 'subscription_cancelled', reason: 'subscription-cancelled', value: price, isRecurring: false };
    }

    // No transition but a payment event fired (renewal)
    // Renewals always use full price (discount is one-time only)
    if (!transitionName && isPaymentEvent(eventType) && price > 0) {
      return { ...base, event: 'subscription_renewed', reason: 'renewal', value: price, isRecurring: true };
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
 * What a refund actually reversed: the processor's amount, then the amount the
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
  // Exported for testing
  resolvePaymentEvent,
  isPaymentEvent,
  buildParams,
  resolveEventId,
};
