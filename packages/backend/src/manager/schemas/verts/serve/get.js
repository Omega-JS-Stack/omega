/**
 * Schema for GET /verts/serve
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  parent: f.string({ default: '' }),
  tags: f.string({ default: '' }),
  width: f.multi(['string', 'number'], { default: '' }),
  height: f.multi(['string', 'number'], { default: '' }),
  theme: f.string({ default: '', enum: ['', 'light', 'dark'] }),
  vertId: f.string({ default: '' }),
});
