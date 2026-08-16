/**
 * Schema: POST /payments/winback
 * Validates the request to accept the cancel-flow save offer
 *
 * The offer's CONTENT is never a request field — it is the brand's config
 * (#268), resolved server-side — so confirmation is the whole payload.
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  confirmed: f.boolean({ required: true }),
});
