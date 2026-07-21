/**
 * Schema for DELETE /verts
 */
const { fields: f } = require('../../helpers/schema-zod.js');

module.exports = () => f.object({
  id: f.string({ default: undefined, required: true }),
});
