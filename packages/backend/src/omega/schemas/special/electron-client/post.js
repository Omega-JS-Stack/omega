/**
 * Schema for POST /special/electron-client
 */
module.exports = () => ({
  uid: { type: 'string' },
  brandId: { type: 'string' },
  brand: { type: 'string' },
  config: { type: 'object', default: {} },
});
