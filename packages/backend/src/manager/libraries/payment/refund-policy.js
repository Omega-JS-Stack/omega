/**
 * Refund policy — the ONE home of the brand's refund window.
 *
 * Every refund provider answers the same question ("is this payment recent
 * enough for a full refund, or is it prorated by days remaining?") and the
 * answer must be identical across Stripe, PayPal, and Chargebee: a user who
 * paid the same day must not get a different outcome because of which button
 * they checked out with. Three private copies of the number would drift; this
 * is the single definition all three import ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 */

// Payments this many days old or younger refund in FULL. Older ones prorate by
// the days remaining in the billing period the payment bought.
const FULL_REFUND_DAYS = 7;

module.exports = {
  FULL_REFUND_DAYS,
};
