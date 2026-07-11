const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  amount: f.number({ default: 1, required: false }),
});
