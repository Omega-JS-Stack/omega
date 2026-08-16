/**
 * The cancel-flow save offer, in the shape the payment stack already speaks
 * ([#268](https://github.com/Omega-JS-Stack/omega/issues/268)).
 *
 * A customer who starts cancelling is pitched a discount on the next cycle
 * before the questionnaire. What the offer IS belongs to the brand
 * (`payment.winback` in omega.json5, resolved by @omega.js/config — 50% off the
 * next cycle when a brand configures nothing), so nothing here carries a number
 * of its own.
 *
 * Everything downstream of the apply route — the Stripe coupon builder, the
 * order doc, the analytics line — already reads a discount-codes VALIDATE
 * RESULT, so the offer is handed over as one instead of teaching each of them a
 * second shape. It is not a code anyone can type: the codes table is the SSOT
 * for what a customer may enter, and this offer is never entered, only accepted.
 */
const { resolveWinbackOffer } = require('@omega.js/config');

/**
 * The offer a resolved config makes, framework default applied.
 *
 * @param {object} config - The Manager's resolved config
 * @returns {{ enabled: boolean, percent?: number, amount?: number, duration: string }}
 */
function resolveOffer(config) {
  return resolveWinbackOffer(config?.payment);
}

/**
 * The offer as a discount-codes validate() result.
 *
 * The synthetic code names the offer for every downstream reader — it is what
 * the processors derive their deterministic coupon id from, so two brands on the
 * same percentage share one coupon and a brand that changes its mind gets a new
 * one instead of silently reusing the old number.
 *
 * The absent shape is OMITTED, never set to undefined: this object is written
 * onto payments-orders/{orderId}, and firebase-admin refuses a document carrying
 * an undefined value (the rule discount-codes.validate() records at length).
 *
 * @param {object} offer - A resolveOffer() result
 * @returns {{ valid: boolean, code: string, percent?: number, amount?: number, duration: string }}
 */
function toDiscount(offer) {
  const isAmount = offer.amount > 0;

  return {
    valid: true,
    code: isAmount ? `WINBACK${offer.amount}OFF` : `WINBACK${offer.percent}`,
    ...(isAmount ? { amount: offer.amount } : { percent: offer.percent }),
    duration: offer.duration,
  };
}

module.exports = { resolveOffer, toDiscount };
