const { fields: f } = require('../../../helpers/schema-zod.js');
const env = require('../../../libraries/env.js');

module.exports = () => f.object({
  name: f.string({ default: undefined, required: false }),
  input: f.string({ default: undefined, required: false }),
  version: f.multi(['string', 'number'], { default: '5', required: false }),
  namespace: f.string({ default: env.get('OMEGA_NAMESPACE'), required: false }),
});
