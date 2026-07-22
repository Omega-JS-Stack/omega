/**
 * GET /admin/firestore - Read Firestore document
 * Admin-only endpoint to read any document
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

  ctx.log('main(): Reading', settings.path);

  // Read from Firestore
  const doc = await admin.firestore().doc(settings.path).get()
    .catch((e) => e);

  if (doc instanceof Error) {
    return ctx.respond(doc.message, { code: 500 });
  }

  // Return empty object if document doesn't exist (doc.data() returns undefined)
  return ctx.respond(doc.data() || {});
};
