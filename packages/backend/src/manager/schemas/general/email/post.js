/**
 * Schema for POST /general/email
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  id: f.string({ default: undefined, required: true }),
  email: f.string({ default: undefined, required: true }),
  name: f.string({ default: '' }),
});
