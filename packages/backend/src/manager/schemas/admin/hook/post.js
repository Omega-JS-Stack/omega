/**
 * Schema for POST /admin/hook
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  path: f.string({ default: undefined, required: true }),
});
