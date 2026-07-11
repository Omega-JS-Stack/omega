const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  url: f.string({ default: 'https://itwcreativeworks.com', required: false }),
});
