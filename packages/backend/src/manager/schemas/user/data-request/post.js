const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  confirmed: f.boolean({ default: false }),
  reason: f.string({ default: '' }),
});
