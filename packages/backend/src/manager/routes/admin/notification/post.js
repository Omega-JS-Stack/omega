/**
 * POST /admin/notification - Send FCM push notification
 * Admin-only endpoint to send push notifications.
 * Uses shared notification library (also used by marketing-campaigns cron).
 */
const notification = require('../../../libraries/notification.js');

module.exports = async ({ ctx, user, settings, analytics }) => {
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }
  if (!user.roles.admin) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  if (!settings.notification.title || !settings.notification.body) {
    return ctx.respond('Parameters <title> and <body> required', { code: 400 });
  }

  const result = await notification.send(ctx, {
    title: settings.notification.title,
    body: settings.notification.body,
    icon: settings.notification.icon,
    clickAction: settings.notification.clickAction
      || settings.notification.click_action,
    filters: {
      tags: settings.filters.tags || false,
      owner: settings.filters.owner || null,
      token: settings.filters.token || null,
      limit: settings.filters.limit || null,
    },
  });

  analytics.event('admin/notification', { sent: result.sent });

  return ctx.respond(result);
};
