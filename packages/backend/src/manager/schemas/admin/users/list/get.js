/**
 * Schema for GET /admin/users/list
 */
const { fields: f } = require('../../../../helpers/schema-zod.js');

module.exports = () => f.object({
  limit: f.number({ default: 20, required: false }),
  search: f.string({ default: '', required: false }),
  startAfter: f.string({ default: '', required: false }),
});
