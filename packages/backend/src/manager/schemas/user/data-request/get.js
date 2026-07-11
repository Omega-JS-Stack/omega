const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  action: f.string({ default: 'status', required: false }),
});
