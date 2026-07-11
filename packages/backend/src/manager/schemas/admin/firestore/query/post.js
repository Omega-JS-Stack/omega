const { fields: f } = require('../../../../helpers/schema-zod.js');

module.exports = () => f.object({
  queries: f.array({ default: [], required: false }),
});
