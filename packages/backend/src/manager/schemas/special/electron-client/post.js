/**
 * Schema for POST /special/electron-client
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  uid: f.string({ default: undefined }),
  brandId: f.string({ default: undefined }),
  brand: f.string({ default: undefined }),
  config: f.passthrough({ default: {} }),
});
