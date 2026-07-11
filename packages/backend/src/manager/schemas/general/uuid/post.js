const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  name: f.string({ default: undefined, required: false }),
  input: f.string({ default: undefined, required: false }),
  version: f.multi(['string', 'number'], { default: '5', required: false }),
  namespace: f.string({ default: process.env.OMEGA_NAMESPACE, required: false }),
});
