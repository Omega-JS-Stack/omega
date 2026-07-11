/**
 * Schema for POST /admin/users/sync
 */
const { fields: f } = require('../../../../helpers/schema-zod.js');

// No specific parameters required, uses stored pageToken
module.exports = () => f.object({});
