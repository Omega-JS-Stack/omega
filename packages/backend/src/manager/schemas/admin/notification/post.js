/**
 * Schema for POST /admin/notification
 * (The route reads named props only and rebuilds filters explicitly, so the zod
 * engine's clean defaults — no injected types/min/max keys — are wire-identical.)
 */
const { fields: f } = require('../../../helpers/schema-zod.js');

module.exports = () => f.object({
  notification: f.passthrough({
    default: {
      title: 'Notification',
      body: 'Check this out',
    },
  }),
  filters: f.passthrough({
    default: {
      tags: false,
      owner: null,
      token: null,
      limit: null,
    },
  }),
});
