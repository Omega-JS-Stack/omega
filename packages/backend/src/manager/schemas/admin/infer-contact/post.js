const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  email: f.string({ default: '', required: false }),
  emails: f.array({ default: [], required: false }),
});
