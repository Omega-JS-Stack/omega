/**
 * Schema: GET /payments/discount
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  code: f.string({ required: true }),
});
