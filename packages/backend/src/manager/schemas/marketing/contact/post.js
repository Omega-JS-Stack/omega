/**
 * Schema for POST /marketing/contact
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  email: f.string({ default: undefined, required: true }),
  firstName: f.string({ default: '' }),
  lastName: f.string({ default: '' }),
  source: f.string({ default: 'unknown' }),
  tags: f.array({ default: [] }),
  skipValidation: f.boolean({ default: false }),
  'g-recaptcha-response': f.string({ default: undefined }),
});
