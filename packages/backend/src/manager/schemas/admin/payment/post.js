/**
 * Schema for POST /admin/payment
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  payload: f.passthrough({ default: {} }),
});
