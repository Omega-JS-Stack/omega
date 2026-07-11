const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  rating: f.string({ default: undefined, required: true }),
  positive: f.string({ default: '', required: false }),
  negative: f.string({ default: '', required: false }),
  comments: f.string({ default: '', required: false }),
});
