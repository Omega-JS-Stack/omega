/**
 * Schema: POST /payments/uncancel
 * Validates the request to withdraw a scheduled subscription cancellation
 */
module.exports = () => ({
  confirmed: { type: 'boolean', required: true },
});
