/**
 * Schema for GET /marketing/campaign
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  id: f.string({ default: '' }),
  start: f.multi(['string', 'number'], { default: '' }),
  end: f.multi(['string', 'number'], { default: '' }),
  status: f.string({ default: '' }),
  type: f.string({ default: '' }),
  limit: f.multi(['string', 'number'], { default: 100 }),
});
