/**
 * Schema for POST /general/email
 */
module.exports = () => ({
  id: { type: 'string', required: true },
  email: { type: 'string', required: true },
  name: { type: 'string', default: '' },
});
