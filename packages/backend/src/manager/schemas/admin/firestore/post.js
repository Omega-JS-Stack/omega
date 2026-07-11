const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  path: f.string({ default: undefined, required: true }),
  document: f.passthrough({ default: {}, required: false }),
  merge: f.boolean({ default: true, required: false }),
  metadataTag: f.string({ default: 'admin/firestore', required: false }),
});
