/**
 * PayPal uncancel provider — DELIBERATELY EMPTY.
 *
 * PayPal cannot resume a cancelled subscription. Its only reactivation verb,
 * `/v1/billing/subscriptions/{id}/activate`, works on a SUSPENDED subscription;
 * a CANCELLED one is terminal, and PayPal answers 422
 * (`SUBSCRIPTION_STATUS_INVALID`). There is no "un-cancel" to call.
 *
 * That matters here because PayPal has no cancel-at-period-end either: our cancel
 * route cancels the PayPal subscription outright and the pipeline represents the
 * remaining paid term as `cancellation.pending` (see the unified mapping in
 * libraries/payment/providers/paypal.js). So a PayPal subscriber whose state
 * reads "pending cancellation" is already cancelled at PayPal — the state this
 * route exists to undo is the one PayPal will not undo.
 *
 * The module exports NOTHING on purpose: the capability gate in ../post.js reads
 * `typeof providerModule.uncancel === 'function'`, so the absent export IS the
 * declaration, and the caller gets a `not-supported-by-provider` 400 pointing at
 * the billing portal instead of a provider error
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 *
 * The file still has to EXIST: without it the route would answer "Unknown
 * provider", which is a different (and wrong) statement about PayPal.
 */
module.exports = {};
