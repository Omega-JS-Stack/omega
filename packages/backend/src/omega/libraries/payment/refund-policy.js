/**
 * Refund policy — the ONE home of the brand's refund window.
 *
 * Every refund provider answers the same question ("is this payment recent
 * enough for a full refund, or is it prorated by days remaining?") and the
 * answer must be identical across Stripe, PayPal, and Chargebee: a user who
 * paid the same day must not get a different outcome because of which button
 * they checked out with. Three private copies of the number would drift; this
 * is the single definition all three import ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * It is also where a ONE-TIME order's refundability is decided, for the same
 * reason: the refund route enforces it, and the account page's orders list has
 * to offer the button on exactly the orders that route would accept. Two
 * spellings of "refundable" would eventually offer a button that 400s
 * ([#672](https://github.com/Omega-JS-Stack/omega/issues/672)).
 */

// Payments this many days old or younger refund in FULL. Older ones prorate by
// the days remaining in the billing period the payment bought.
const FULL_REFUND_DAYS = 7;

// Payments older than this are not eligible for a refund, whatever was bought.
const REFUND_WINDOW_SECONDS = 6 * 30 * 24 * 60 * 60;
const OUTSIDE_WINDOW_MESSAGE = 'Payments older than 6 months are not eligible for refunds';

// Providers with no refund API at all. Coinbase Commerce settles in crypto and
// exposes no refund endpoint — returning coins is a manual transfer the merchant
// makes from its dashboard, at whatever the coin is worth that day, and nothing
// about it is ever attached to the charge. So the refusal belongs HERE, with
// every other one, rather than as a provider call that could only ever fail: the
// route would answer the customer "try again shortly" for something no retry can
// fix, and the account page would offer a Refund button on it
// ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
const NO_REFUND_PROVIDERS = ['coinbase'];
const NO_REFUND_MESSAGE = 'Crypto purchases cannot be refunded automatically. Contact support and we will arrange it by hand.';

/**
 * Is a payment recent enough to refund? An absent date cannot disqualify one.
 *
 * @param {number} [paidUNIX] - When the payment happened
 * @returns {boolean}
 */
function isWithinRefundWindow(paidUNIX) {
  if (!paidUNIX) {
    return true;
  }

  return paidUNIX >= Math.floor(Date.now() / 1000) - REFUND_WINDOW_SECONDS;
}

/**
 * Why this one-time order cannot be refunded, if it cannot.
 *
 * Ownership is deliberately NOT here: that is an authorization question the
 * caller answers (the refund route compares the order's owner against the
 * caller; the orders route only ever reads the caller's own).
 *
 * @param {object} order - The payments-orders document
 * @returns {{ reason: string, message: string }|null} The refusal, or null when the order is refundable
 */
function oneTimeRefundRefusal(order) {
  if (!order || order.type !== 'one-time') {
    return { reason: 'not-one-time', message: 'That order is not a one-time purchase' };
  }

  // requests.refund covers the in-app path; unified.status covers a refund issued
  // from the provider dashboard, which arrives by webhook and writes no request
  if (order.requests?.refund || order.unified?.status === 'refunded') {
    return { reason: 'already-refunded', message: 'This purchase has already been refunded' };
  }

  // Nothing was captured, so there is nothing to reverse. Every provider
  // normalizes a successful purchase to 'completed' and passes its own word
  // through otherwise (stripe.js:485, paypal.js:326, chargebee.js:416-423), so an
  // abandoned checkout keeps its provider and its resourceId and passed every
  // other refusal — the orders list offered a refund button on a Failed pill, and
  // pressing it asked the provider to refund a charge that never happened
  if (order.unified?.status !== 'completed') {
    return { reason: 'not-completed', message: 'That purchase has not completed' };
  }

  // The purchase date is the order's creation; the last webhook write is the fallback
  const purchasedUNIX = order.metadata?.created?.timestampUNIX
    || order.unified?.payment?.updatedBy?.date?.timestampUNIX;

  if (!isWithinRefundWindow(purchasedUNIX)) {
    return { reason: 'outside-window', message: OUTSIDE_WINDOW_MESSAGE };
  }

  const provider = order.provider || order.unified?.payment?.provider;
  const resourceId = order.resourceId || order.unified?.payment?.resourceId;

  if (!provider || !resourceId) {
    return { reason: 'missing-payment-details', message: 'Order payment details not found' };
  }

  // Last, because it is the least specific thing wrong with an order: a crypto
  // purchase that is also already refunded should still say so.
  if (NO_REFUND_PROVIDERS.includes(provider)) {
    return { reason: 'provider-cannot-refund', message: NO_REFUND_MESSAGE };
  }

  return null;
}

module.exports = {
  FULL_REFUND_DAYS,
  REFUND_WINDOW_SECONDS,
  OUTSIDE_WINDOW_MESSAGE,
  NO_REFUND_PROVIDERS,
  isWithinRefundWindow,
  oneTimeRefundRefusal,
};
