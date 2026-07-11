/**
 * Schema: GET /payments/trial-eligibility
 * No parameters required — uses authenticated user's UID
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({});
