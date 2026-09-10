/**
 * Provider-error classification — does a provider's failure mean the resource is
 * AFFIRMATIVELY GONE, or was the provider simply unreachable?
 *
 * The one place the difference is decided, for every provider and every caller:
 *
 * - **The cancel route** may force-write a cancelled subscription for a suspended
 *   user whose provider record no longer exists, so the user can re-subscribe.
 *   That write must answer to the provider saying "no such subscription" and
 *   nothing else: a network blip, an expired key, or a rate limit is transient,
 *   and treating it as "already gone" hands out a cancellation the provider never
 *   made ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 * - **The trial lapse sweep** only lapses a trial the provider says is gone.
 * - **`fetchResource()`** ([fetch-failure.js](fetch-failure.js)) splits a webhook's
 *   failed lookup into the two outcomes the pipeline acts on: a resource the
 *   provider does not have is REFUSED and acknowledged, while an unreachable
 *   provider DEFERS for redelivery ([#506](https://github.com/Omega-JS-Stack/omega/issues/506)).
 *
 * The shapes, as each SDK/client in this repo actually surfaces them:
 *
 * - **Stripe** — the SDK throws `StripeInvalidRequestError` with
 *   `code: 'resource_missing'` and `statusCode: 404` ("No such subscription: …").
 * - **Chargebee** — `libraries/payment/providers/chargebee.js` stamps
 *   `err.statusCode` from the HTTP response; a deleted subscription answers 404
 *   (`resource_not_found`).
 * - **Coinbase Commerce** — `libraries/payment/providers/coinbase.js` stamps
 *   `err.statusCode` from the HTTP response the same way, so a charge Coinbase
 *   does not have (404) needs no rule of its own here
 *   ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
 * - **PayPal** — `libraries/payment/providers/paypal.js` throws a plain Error
 *   whose message carries the status: `PayPal API 404: …` (`RESOURCE_NOT_FOUND`).
 *   PayPal's other "already gone" answer — 422 with issue
 *   `SUBSCRIPTION_STATUS_INVALID` for an already-cancelled subscription — is
 *   deliberately NOT classified: that client surfaces only `data.message`, never
 *   the `details[].issue` code, so a 422 here is indistinguishable from any
 *   other validation failure. It stays in the transient bucket.
 * - **test** — throws plain Errors; nothing it raises means "already gone".
 *
 * Anything unrecognized is transient by construction: an unknown error must
 * never be the one that writes.
 */

// `PayPal API <status>: <message>`, the one shape the PayPal client throws with.
const PAYPAL_STATUS = /^PayPal API (\d{3})\b/;

/**
 * Does this provider error mean the resource no longer exists?
 *
 * @param {Error} e - The error a provider call threw
 * @returns {boolean}
 */
module.exports = function isAlreadyGone(e) {
  if (!e) {
    return false;
  }

  // Stripe's own code for "that object does not exist"
  if (e.code === 'resource_missing') {
    return true;
  }

  // Stripe + Chargebee both carry the HTTP status on the error
  if (e.statusCode === 404) {
    return true;
  }

  // PayPal carries it in the message only
  const paypalStatus = PAYPAL_STATUS.exec(e.message || '');

  return paypalStatus ? paypalStatus[1] === '404' : false;
};
