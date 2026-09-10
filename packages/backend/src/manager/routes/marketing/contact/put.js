/**
 * PUT /marketing/contact - Sync marketing contact by UID
 * Admin-only endpoint to re-sync a user's data to marketing providers
 */

module.exports = async ({ ctx, Manager, settings, analytics }) => {

  // The caller the middleware authenticated — the usage counter is lazy now
  // and was never the right place to read a role from (#647)
  const isAdmin = ctx.getUser().roles?.admin;

  // Admin only endpoint
  if (!isAdmin) {
    return ctx.respond('Admin access required', { code: 403 });
  }

  const uid = (settings.uid || '').trim();

  if (!uid) {
    return ctx.respond('UID is required', { code: 400 });
  }

  // Sync via email library (accepts UID string, resolves user doc internally)
  const mailer = Manager.Email(ctx);
  const result = await mailer.sync(uid);

  // Log result
  ctx.log('marketing/contact sync result:', { uid, providers: result });

  // Track analytics
  analytics.event('marketing/contact', { action: 'sync' });

  return ctx.respond({
    success: true,
    providers: result,
  });
};
