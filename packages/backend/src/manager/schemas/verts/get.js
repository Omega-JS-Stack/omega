/**
 * Schema for GET /verts
 */
const { fields: f } = require('../../helpers/schema-zod.js');

module.exports = () => f.object({
  id: f.string({ default: '' }),
  limit: f.multi(['string', 'number'], { default: 100 }),
});
