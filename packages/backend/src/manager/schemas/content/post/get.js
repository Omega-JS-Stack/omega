/**
 * Schema for GET /content/post
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  url: f.string({ default: undefined, required: true }),
  // Which web target to read the post from (#887): optional for a brand with
  // one web target, required when it runs several
  target: f.string({ default: undefined }),
});
