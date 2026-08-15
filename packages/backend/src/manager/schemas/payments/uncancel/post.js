/**
 * Schema: POST /payments/uncancel
 * Validates the request to withdraw a scheduled subscription cancellation
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  confirmed: f.boolean({ required: true }),
});
