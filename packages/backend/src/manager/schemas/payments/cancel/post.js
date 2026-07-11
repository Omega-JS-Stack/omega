/**
 * Schema: POST /payments/cancel
 * Validates subscription cancellation parameters
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  reason: f.string({ default: null }),
  feedback: f.string({ default: null }),
  confirmed: f.boolean({ required: true }),
  // Bypass route-level guards (e.g. 24-hour subscription age). Used by tests and internal callers.
  skipGuards: f.boolean({ default: false }),
});
