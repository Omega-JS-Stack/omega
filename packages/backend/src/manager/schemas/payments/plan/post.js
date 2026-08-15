/**
 * Schema: POST /payments/plan
 * Validates the target plan of a subscription plan switch
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  productId: f.string({ required: true }),
  frequency: f.string({ required: true }),
  confirmed: f.boolean({ required: true }),
});
