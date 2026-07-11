/**
 * Schema for POST /admin/backup
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  deletionRegex: f.string({ default: undefined }),
});
