/**
 * Schema for POST /admin/users/disable
 */
module.exports = () => ({
  uid: { type: 'string', required: true },
  disabled: { type: 'boolean', default: true },
});
