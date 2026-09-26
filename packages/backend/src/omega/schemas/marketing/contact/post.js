/**
 * Schema for POST /marketing/contact
 */
module.exports = () => ({
  email: { type: 'string', required: true },
  firstName: { type: 'string', default: '' },
  lastName: { type: 'string', default: '' },
  source: { type: 'string', default: 'unknown' },
  tags: { type: 'array', default: [] },
  skipValidation: { type: 'boolean', default: false },
  'g-recaptcha-response': { type: 'string' },
});
