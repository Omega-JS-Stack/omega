/**
 * Schema for POST /admin/email
 *
 * Recipients (to, cc, bcc) accept flexible formats:
 * - Email string: "user@example.com"
 * - UID string (no @): "abc123" — auto-fetches user doc from Firestore
 * - Email object: { email: "user@example.com", name: "John" }
 * - Array of any of the above
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  to: f.multi(['array', 'string', 'object'], { default: [] }),
  cc: f.multi(['array', 'string', 'object'], { default: [] }),
  bcc: f.multi(['array', 'string', 'object'], { default: [] }),
  from: f.passthrough({ default: undefined }),
  replyTo: f.string({ default: undefined }),
  sender: f.string({ default: undefined }),
  subject: f.string({ default: undefined }),
  template: f.string({ default: 'card' }),
  group: f.multi(['number', 'string'], { default: undefined }),
  sendAt: f.multi(['number', 'string'], { default: undefined }),
  data: f.passthrough({ default: {} }),
  categories: f.array({ default: [] }),
  copy: f.boolean({ default: undefined }),
  html: f.string({ default: undefined, sanitize: false }),
});
