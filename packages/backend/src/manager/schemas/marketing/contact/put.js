/**
 * Schema for PUT /marketing/contact (sync)
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  uid: f.string({ default: undefined, required: true }),
});
