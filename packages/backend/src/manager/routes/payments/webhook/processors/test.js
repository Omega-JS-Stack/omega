/**
 * Test webhook processor
 * Delegates to Stripe's parser since test processor generates Stripe-shaped event payloads
 *
 * Only the parser is delegated: these events are FABRICATED locally and signed by
 * nobody, so the processor stays key-only (the route's production guard is what
 * keeps it out of production). Never forward Stripe's verifySignature() here.
 */
const stripeProcessor = require('./stripe.js');

module.exports = {
  isSupported(eventType) {
    return stripeProcessor.isSupported(eventType);
  },

  parseWebhook(req) {
    return stripeProcessor.parseWebhook(req);
  },
};
