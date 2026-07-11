const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  update: f.multi(['boolean', 'object'], { default: false, required: false }),
});
