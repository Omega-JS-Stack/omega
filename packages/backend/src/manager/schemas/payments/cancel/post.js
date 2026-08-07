/**
 * Schema: POST /payments/cancel
 * Validates subscription cancellation parameters
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  reason: f.string({ default: null }),
  feedback: f.string({ default: null }),
  confirmed: f.boolean({ required: true }),
  // REQUEST to bypass route-level guards (e.g. 24-hour subscription age). Any client
  // can send it; the route honors it only for an admin or outside a real deployment,
  // and ignores it with a warning otherwise ([#212]).
  skipGuards: f.boolean({ default: false }),
});
