/**
 * Schema for GET /content/post
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  url: f.string({ default: undefined, required: true }),
});
