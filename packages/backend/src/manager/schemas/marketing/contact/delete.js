/**
 * Schema for DELETE /marketing/contact
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  email: f.string({ default: undefined, required: true }),
});
