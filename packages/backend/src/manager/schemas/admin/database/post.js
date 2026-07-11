const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  path: f.string({ default: undefined, required: true }),
  document: f.multi(['object', 'string', 'number', 'boolean', 'array'], { default: {}, required: false }),
});
