/**
 * Schema: POST /payments/intent
 * Validates intent creation parameters
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  processor: f.string({ required: true }),
  productId: f.string({ required: true }),
  frequency: f.string({ default: null }),
  trial: f.boolean({ default: false }),
  verification: f.passthrough({ default: {} }),
  attribution: f.passthrough({ default: {} }),
  discount: f.string({ default: null }),
  supplemental: f.passthrough({ default: {} }),
});
