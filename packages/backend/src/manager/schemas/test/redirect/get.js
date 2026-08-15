const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  // Relative paths only — the handler refuses anything else, so the default is
  // one too (it used to be an absolute URL).
  url: f.string({ default: '/', required: false }),
});
