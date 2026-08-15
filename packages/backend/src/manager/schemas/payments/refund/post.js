/**
 * Schema: POST /payments/refund
 * Validates refund parameters for both subjects a refund can have
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  reason: f.string({ required: true }),
  feedback: f.string({ default: null }),
  confirmed: f.boolean({ required: true }),
  // The payments-orders id of a ONE-TIME purchase. Present = refund that
  // purchase; absent = refund the caller's subscription ([#212]).
  orderId: f.string({ default: null }),
});
