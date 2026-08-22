/**
 * Schema: POST /payments/portal
 * Validates billing portal session parameters
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  // Where the provider's hosted portal returns the user. Client-settable, so the
  // route accepts it only on one of the brand's own origins and falls back to the
  // brand's account page otherwise ([#212]).
  returnUrl: f.string({ default: null }),
});
