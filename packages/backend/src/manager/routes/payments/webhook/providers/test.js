/**
 * Test webhook provider
 * Delegates to Stripe's parser since test provider generates Stripe-shaped event payloads
 *
 * Only the parser is delegated: these events are FABRICATED locally and signed by
 * nobody, so the provider stays key-only (the route's production guard is what
 * keeps it out of production). Never forward Stripe's verifySignature() here.
 */
const stripeProvider = require('./stripe.js');

module.exports = {
  isSupported(eventType) {
    return stripeProvider.isSupported(eventType);
  },

  parseWebhook(req) {
    return stripeProvider.parseWebhook(req);
  },
};
