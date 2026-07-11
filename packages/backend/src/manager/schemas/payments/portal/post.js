/**
 * Schema: POST /payments/portal
 * Validates billing portal session parameters
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  returnUrl: f.string({ default: null }),
});
