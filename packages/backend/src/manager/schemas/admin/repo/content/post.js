/**
 * Schema for POST /admin/repo/content
 */
const { fields: f } = require('../../../../helpers/schema-zod.js');

module.exports = () => f.object({
  path: f.string({ default: undefined, required: true }),
  content: f.string({ default: undefined, required: true }),
  type: f.string({ default: 'text' }),
  // Which web target the file belongs to (#887): optional for a brand with one
  // web target, required when it runs several
  target: f.string({ default: undefined }),
});
