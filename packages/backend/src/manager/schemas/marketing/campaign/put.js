/**
 * Schema for PUT /marketing/campaign
 * All fields optional except id — only provided fields are updated.
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  id: f.string({ default: undefined, required: true }),
  type: f.string({ default: '' }),

  // Content
  name: f.string({ default: '' }),
  subject: f.string({ default: '' }),
  preheader: f.string({ default: '' }),
  template: f.string({ default: '' }),
  content: f.string({ default: '' }),
  data: f.passthrough({ default: undefined }),

  // Targeting
  lists: f.array({ default: undefined }),
  segments: f.array({ default: undefined }),
  excludeSegments: f.array({ default: undefined }),
  all: f.boolean({ default: undefined }),

  // Scheduling
  sendAt: f.multi(['string', 'number'], { default: '' }),
  recurrence: f.passthrough({ default: undefined }),

  // UTM
  utm: f.passthrough({ default: undefined }),

  // Config
  sender: f.string({ default: '' }),
  providers: f.array({ default: undefined }),
  group: f.string({ default: '' }),
  categories: f.array({ default: undefined }),
});
