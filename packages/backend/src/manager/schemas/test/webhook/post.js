const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  delay: f.number({ default: 0, required: false }),
  status: f.number({ default: 200, required: false }),
  response: f.multi(['object', 'string'], { default: {}, required: false }),
});
