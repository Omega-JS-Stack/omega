/**
 * Schema for GET /verts
 */
module.exports = () => ({
  id: { type: 'string', default: '' },
  limit: { type: ['string', 'number'], default: 100 },
});
