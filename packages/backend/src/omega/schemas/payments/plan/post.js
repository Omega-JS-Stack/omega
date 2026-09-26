/**
 * Schema: POST /payments/plan
 * Validates the target plan of a subscription plan switch
 */
module.exports = () => ({
  productId: { type: 'string', required: true },
  frequency: { type: 'string', required: true },
  confirmed: { type: 'boolean', required: true },
});
