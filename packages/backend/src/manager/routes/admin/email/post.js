/**
 * POST /admin/email - Send email via SendGrid
 *
 * Admin-only endpoint to send transactional emails.
 * Supports flexible recipient formats (string, object, UID, or arrays of mixed).
 *
 * See: src/manager/libraries/email/ for the shared email builder and sender.
 */
module.exports = async ({ ctx, user, settings }) => {
  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Require admin
  if (!user.roles.admin) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  // Check for SendGrid key
  if (!process.env.SENDGRID_API_KEY) {
    return ctx.respond('SendGrid API key not configured.', { code: 500 });
  }

  ctx.log('Request:', settings);

  const email = ctx.Manager.Email(ctx);
  const result = await email.send(settings).catch(e => e);

  if (result instanceof Error) {
    return ctx.respond(result.message, { code: result.code || 500 });
  }

  return ctx.respond(result);
};
