/**
 * Schema for PUT /ads
 * Only provided fields update — everything except id defaults to undefined.
 */
const { fields: f } = require('../../helpers/schema-zod.js');

module.exports = () => f.object({
  id: f.string({ default: undefined, required: true }),
  enabled: f.boolean({ default: undefined }),
  title: f.string({ default: undefined }),
  description: f.string({ default: undefined }),
  button: f.string({ default: undefined }),
  link: f.string({ default: undefined }),
  image: f.string({ default: undefined }),
  footer: f.string({ default: undefined }),
  weight: f.number({ default: undefined, min: 1 }),
  targeting: f.passthrough({ default: undefined }),
  whitelist: f.array({ default: undefined }),
  blacklist: f.array({ default: undefined }),
});
