/**
 * Schema for GET /verts/redirect
 */
module.exports = () => ({
  id: { type: 'string', required: true },
  parent: { type: 'string', default: '' },
  brand: { type: 'string', default: '' },
});
