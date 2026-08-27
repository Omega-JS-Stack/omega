/**
 * Schema: POST /payments/intent
 * Validates intent creation parameters
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  provider: f.string({ required: true }),
  productId: f.string({ required: true }),
  frequency: f.string({ default: null }),
  trial: f.boolean({ default: false }),
  verification: f.passthrough({ default: {} }),
  attribution: f.passthrough({ default: {} }),
  // The client's tracking-consent snapshot, stored verbatim beside attribution and
  // folded onto the order — never interpreted here. Absent when nothing was captured.
  trackingConsent: f.passthrough({ default: null }),
  discount: f.string({ default: null }),
  supplemental: f.passthrough({ default: {} }),
  // Checkout simulation — honored ONLY by the test provider (itself
  // non-production), ignored everywhere else. Request-only: it is never
  // persisted onto the intent or the order.
  //
  // `abandon` is the checkout nobody finishes: the session is created and the
  // provider never sends an event, because none happened. It is the only way to
  // reach the state the abandoned-cart lane exists for
  // ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
  simulate: f.string({ default: null, enum: ['decline', 'abandon'] }),
});
