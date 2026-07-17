/**
 * Schema for POST /admin/users/disable
 */
const { fields: f } = require('../../../../helpers/schema-zod.js');

module.exports = () => f.object({
  uid: f.string({ required: true }),
  disabled: f.boolean({ default: true, required: false }),
});
