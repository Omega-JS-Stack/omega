/**
 * Schema for POST /admin/repo/content
 */
const { fields: f } = require('../../../../helpers/schema-zod.js');

module.exports = () => f.object({
  path: f.string({ default: undefined, required: true }),
  content: f.string({ default: undefined, required: true }),
  type: f.string({ default: 'text' }),
});
