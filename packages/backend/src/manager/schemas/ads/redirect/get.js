/**
 * Schema for GET /ads/redirect
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  id: f.string({ default: undefined, required: true }),
  parent: f.string({ default: '' }),
});
