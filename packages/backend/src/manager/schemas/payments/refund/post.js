/**
 * Schema: POST /payments/refund
 * Validates subscription refund parameters
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  reason: f.string({ required: true }),
  feedback: f.string({ default: null }),
  confirmed: f.boolean({ required: true }),
});
