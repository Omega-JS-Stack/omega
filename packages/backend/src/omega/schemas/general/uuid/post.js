const env = require('../../../libraries/env.js');

module.exports = () => ({
  name: { type: 'string' },
  input: { type: 'string' },
  version: { type: ['string', 'number'], default: '5' },
  namespace: { type: 'string', default: env.get('OMEGA_NAMESPACE') },
});
