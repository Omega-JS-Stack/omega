/**
 * Schema for POST /verts
 */
const { fields: f } = require('../../helpers/schema-zod.js');

module.exports = ({ assistant }) => f.object({
  id: f.string({ value: () => assistant.Manager.Utilities().randomId() }),
  enabled: f.boolean({ default: true }),
  title: f.string({ default: undefined, required: true }),
  description: f.string({ default: '' }),
  button: f.string({ default: '' }),
  link: f.string({ default: undefined, required: true }),
  image: f.string({ default: '' }),
  footer: f.string({ default: '' }),
  weight: f.number({ default: 1, min: 1 }),
  targeting: f.object({
    sites: f.array({ default: [] }),
    categories: f.array({ default: [] }),
    keywords: f.array({ default: [] }),
  }),
  whitelist: f.array({ default: [] }),
  blacklist: f.array({ default: [] }),
});
