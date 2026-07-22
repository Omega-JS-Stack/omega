/**
 * POST /admin/cron - Run cron job manually
 * Admin-only endpoint to trigger cron jobs
 */
module.exports = async ({ ctx, Manager, user, settings, analytics }) => {

  // Require authentication (allow in dev)
  if (!user.authenticated && ctx.isProduction()) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Require admin (allow in dev)
  if (!user.roles.admin && ctx.isProduction()) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  // Check for required parameter
  if (!settings.id) {
    return ctx.respond('Missing parameter {id}', { code: 400 });
  }

  ctx.log('Running cron job:', settings.id);

  // Run the cron job
  const cronPath = `${Manager.rootDirectory}/events/cron/${settings.id}.js`;
  const cronHandler = require(cronPath);
  const result = await cronHandler({ Manager, ctx, context: {}, libraries: Manager.libraries }).catch(e => e);

  if (result instanceof Error) {
    return ctx.respond(result.message, { code: 500 });
  }

  // Track analytics
  analytics.event('admin/cron', { id: settings.id });

  return ctx.respond(result);
};
