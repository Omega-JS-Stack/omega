/**
 * Schema for POST /marketing/campaign
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  // Identity
  id: f.string({ default: '' }),
  type: f.string({ default: 'email' }),

  // Content
  name: f.string({ default: undefined, required: true }),
  subject: f.string({ default: undefined, required: true }),
  preheader: f.string({ default: '' }),
  template: f.string({ default: 'card' }),
  data: f.passthrough({ default: {} }),

  // Targeting
  lists: f.array({ default: [] }),
  segments: f.array({ default: [] }),
  excludeSegments: f.array({ default: [] }),
  all: f.boolean({ default: false }),

  // Scheduling
  sendAt: f.multi(['string', 'number'], { default: '' }),
  recurrence: f.passthrough({ default: undefined }),  // { pattern: 'weekly'|'monthly'|'quarterly'|'yearly'|'daily', hour?, day?, month? }

  // UTM
  utm: f.passthrough({ default: {} }),

  // Lineage
  recurringId: f.string({ default: '' }),

  // Push notification targeting
  filters: f.passthrough({ default: {} }),

  // Config
  test: f.boolean({ default: false }),
  sender: f.string({ default: 'marketing' }),
  providers: f.array({ default: [] }),
  group: f.string({ default: '' }),
  categories: f.array({ default: [] }),
});
