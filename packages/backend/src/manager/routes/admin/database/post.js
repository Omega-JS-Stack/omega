/**
 * POST /admin/database - Write Realtime Database
 * Admin-only endpoint to write any path
 */
module.exports = async ({ ctx, user, settings, libraries }) => {
  const { admin } = libraries;

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Require admin
  if (!user.roles.admin) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  // Require path
  if (!settings.path) {
    return ctx.respond('Path parameter required.', { code: 400 });
  }

  ctx.log('main(): Write', settings.path, settings.document);

  // Write to Realtime Database
  const write = await admin.database().ref(settings.path).set(settings.document)
    .catch((e) => e);

  if (write instanceof Error) {
    return ctx.respond(write.message, { code: 500 });
  }

  return ctx.respond(settings.document);
};
