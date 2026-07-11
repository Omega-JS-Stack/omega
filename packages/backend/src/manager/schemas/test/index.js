const { fields: f } = require('../../helpers/schema-zod.js');

module.exports = () => f.object({
  delay: f.number({ default: 1000 }),
});
