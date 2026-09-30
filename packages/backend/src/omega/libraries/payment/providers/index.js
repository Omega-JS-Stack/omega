/**
 * The payment provider registry: one capability descriptor per provider
 * library in this folder, and the one thing a backend decision about a provider
 * reads (the zero-charge guard, the refund refusal, the intent route's gate).
 * The rows live in @omega.js/config, because the checkout page's build bakes
 * the same table: the capability keys are documented there.
 */
const { PAYMENT_PROVIDERS, paymentProvider } = require('@omega.js/config');

module.exports = { PAYMENT_PROVIDERS, paymentProvider };
