/**
 * Test webhook provider
 * Delegates to Stripe's parser since test provider generates Stripe-shaped event payloads
 *
 * Only the parser is delegated: these events are FABRICATED locally, and the
 * route's production guard is what keeps this provider out of production.
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
