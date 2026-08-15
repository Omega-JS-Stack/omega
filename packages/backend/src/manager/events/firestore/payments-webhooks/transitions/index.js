/**
 * Payment transition detection and dispatch
 *
 * Compares subscription state before and after a webhook to detect meaningful
 * transitions (e.g., new subscription, payment failed, cancellation).
 * Dispatches to individual handler files for each transition type.
 */
const path = require('path');

// Webhook event types that mean "money went back to the customer", per processor:
// PayPal PAYMENT.SALE.REFUNDED, Stripe charge.refunded, Chargebee payment_refunded
// (each string is the processor's own, as its webhook parser reports it).
const REFUND_EVENTS = ['PAYMENT.SALE.REFUNDED', 'charge.refunded', 'payment_refunded'];

/**
 * Detect what transition occurred based on category and before/after state
 *
 * @param {string} category - 'subscription' or 'one-time'
 * @param {object|null} before - Previous state (null for new users / one-time)
 * @param {object} after - New unified state about to be written
 * @param {string} eventType - Original webhook event type (used for one-time detection)
 * @param {object} [options] - { previouslyCompleted } — this webhook doc already completed once
 * @returns {string|null} Transition name or null if no meaningful change
 */
function detectTransition(category, before, after, eventType, options) {
  if (category === 'subscription') {
    return detectSubscriptionTransition(before, after, eventType, options);
  }

  if (category === 'one-time') {
    return detectOneTimeTransition(eventType, options);
  }

  return null;
}

/**
 * Detect subscription state transitions by comparing before and after
 *
 * Checks are ordered by specificity — most specific first to avoid misclassification.
 *
 * @param {object|null} before - Previous users/{uid}.subscription (null/undefined for new users)
 * @param {object} after - New unified subscription
 * @param {string} eventType - Original webhook event type
 * @param {object} [options] - { previouslyCompleted } — this webhook doc already completed once
 * @returns {string|null} Transition name
 */
function detectSubscriptionTransition(before, after, eventType, options) {
  if (!after) {
    return null;
  }

  // Refund events take priority — detected by webhook event type rather than state diff
  // because the subscription state may not change meaningfully during a refund
  if (REFUND_EVENTS.includes(eventType)) {
    // Idempotency: refund detection is event-type-only, so a webhook doc that is
    // processed a second time (a redelivery, or a doc put back to pending) would
    // re-dispatch payment-refunded and email the customer about the same refund
    // twice. A doc that already completed once has already sent it.
    if (options?.previouslyCompleted) {
      return null;
    }

    return 'payment-refunded';
  }

  const beforeStatus = before?.status;
  const afterStatus = after.status;

  // 1. new-subscription: basic/null → active paid (handler checks after.trial.claimed for trial info)
  if (isBasicOrNull(before) && afterStatus === 'active' && isPaid(after)) {
    return 'new-subscription';
  }

  // 2. subscription-winback: cancelled paid → active paid. A full cancellation
  // leaves the paid product id in place, so a returning subscriber matched
  // nothing here — no confirmation email, and analytics read the checkout as a
  // renewal ([#218](https://github.com/Omega-JS-Stack/omega/issues/218)).
  if (beforeStatus === 'cancelled' && isPaid(before) && afterStatus === 'active' && isPaid(after)) {
    return 'subscription-winback';
  }

  // 3. checkout-declined: basic/null → suspended. Users are born active on basic,
  // so a declined FIRST checkout reads as active → suspended and used to send the
  // renewal-dunning email to someone who never had a subscription to dun.
  if (isBasicOrNull(before) && afterStatus === 'suspended') {
    return 'checkout-declined';
  }

  // 4. payment-failed: active → suspended
  if (beforeStatus === 'active' && afterStatus === 'suspended') {
    return 'payment-failed';
  }

  // 5. payment-recovered: suspended → active
  if (beforeStatus === 'suspended' && afterStatus === 'active') {
    return 'payment-recovered';
  }

  // 6. cancellation-requested: pending flips from false → true while still active
  if (afterStatus === 'active' && !before?.cancellation?.pending && after.cancellation?.pending) {
    return 'cancellation-requested';
  }

  // 7. cancellation-removed: pending flips from true → false on the same product
  // while still active — the uncancel route's half of the pair above. Same product
  // and behind payment-recovered, so a plan change or a recovery that also clears
  // the schedule keeps its own, more meaningful, name.
  if (
    afterStatus === 'active'
    && before?.cancellation?.pending
    && !after.cancellation?.pending
    && before.product?.id === after.product?.id
  ) {
    return 'cancellation-removed';
  }

  // 8. subscription-cancelled: any non-cancelled → cancelled
  if (beforeStatus !== 'cancelled' && afterStatus === 'cancelled') {
    return 'subscription-cancelled';
  }

  // 9. plan-changed: both active, both paid, different product
  if (
    beforeStatus === 'active'
    && afterStatus === 'active'
    && isPaid(before)
    && isPaid(after)
    && before.product.id !== after.product.id
  ) {
    return 'plan-changed';
  }

  return null;
}

/**
 * Detect one-time payment transitions from event type
 * Simpler than subscriptions — no before/after comparison needed
 *
 * @param {string} eventType - Webhook event type
 * @param {object} [options] - { previouslyCompleted } — this webhook doc already completed once
 * @returns {string|null} Transition name
 */
function detectOneTimeTransition(eventType, options) {
  // Idempotency: EVERY transition on this side is detected from the event type
  // alone, so a webhook doc processed a second time (a redelivery, or a doc put
  // back to pending) would re-dispatch its handler — and email the customer about
  // the same purchase or refund twice. The subscription side guards its
  // event-type-only path the same way.
  if (options?.previouslyCompleted) {
    return null;
  }

  // Refunds first, and by event type alone — a one-time purchase has no
  // before/after state to diff, the event IS the transition. The strings are the
  // same processor strings the subscription side reads
  // ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
  if (REFUND_EVENTS.includes(eventType)) {
    return 'purchase-refunded';
  }

  // Stripe
  if (eventType === 'checkout.session.completed') {
    return 'purchase-completed';
  }

  if (eventType === 'invoice.payment_failed') {
    return 'purchase-failed';
  }

  // PayPal
  if (eventType === 'CHECKOUT.ORDER.APPROVED') {
    return 'purchase-completed';
  }

  return null;
}

/**
 * Dispatch a transition handler (fire-and-forget)
 *
 * @param {string} transitionName - e.g., 'new-subscription', 'payment-failed'
 * @param {string} category - 'subscription' or 'one-time'
 * @param {object} context - Full context passed to the handler
 */
function dispatch(transitionName, category, context) {
  const { ctx } = context;

  try {
    const handlerPath = path.join(__dirname, category, `${transitionName}.js`);
    const handler = require(handlerPath);

    // Fire-and-forget — don't block the main webhook processing
    Promise.resolve(handler(context)).catch((e) => {
      ctx.error(`Transition handler [${category}/${transitionName}] failed: ${e.message}`, e);
    });
  } catch (e) {
    // Handler file doesn't exist or can't be loaded — log but don't fail
    ctx.error(`Transition handler [${category}/${transitionName}] not found: ${e.message}`);
  }
}

// ─── Helpers ───

function isBasicOrNull(sub) {
  return !sub || !sub.product || sub.product.id === 'basic';
}

function isPaid(sub) {
  return sub && sub.product && sub.product.id !== 'basic';
}

module.exports = {
  detectTransition,
  detectSubscriptionTransition,
  detectOneTimeTransition,
  dispatch,
  // Exported for testing
  REFUND_EVENTS,
  isBasicOrNull,
  isPaid,
};
