const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  // Clamped at 0: a negative amount would DECREMENT the counter, and the route
  // keys usage off the caller's uid OR their IP — so an unauthenticated caller
  // could zero their own rate-limit bucket.
  amount: f.number({ default: 1, min: 0, required: false }),
});
