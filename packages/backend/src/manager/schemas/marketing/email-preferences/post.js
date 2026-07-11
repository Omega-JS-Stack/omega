/**
 * Schema for POST /marketing/email-preferences
 *
 * Two supported modes (route decides based on user.authenticated):
 * - Authenticated (account page toggle): action ('subscribe' | 'unsubscribe'). Other fields ignored.
 * - Anonymous (HMAC link from email footer): email + asmId + sig + action ('subscribe' | 'unsubscribe').
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  email: f.string({ default: undefined, required: false }),
  asmId: f.multi(['string', 'number'], { default: undefined, required: false }),
  action: f.string({ default: 'unsubscribe', required: true }),
  sig: f.string({ default: undefined, required: false }),
});
