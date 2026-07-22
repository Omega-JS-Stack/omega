const pushid = require('pushid');

/**
 * POST /admin/firestore - Write Firestore document
 * Admin-only endpoint to write any document
 */
module.exports = async ({ ctx, Manager, user, settings, libraries }) => {
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

  // Process path placeholders
  let path = settings.path;

  if (path.includes('{pushId}')) {
    path = path.replace(/\{pushId\}/gi, pushid());
  } else if (path.includes('{nanoId}')) {
    path = path.replace(/\{nanoId\}/gi, Manager.Utilities().randomId());
  }

  // Prepare document
  const document = {
    ...settings.document,
    metadata: Manager.Metadata().set({ tag: settings.metadataTag }),
  };

  // Build options
  const options = {
    merge: settings.merge,
  };

  ctx.log('main(): Writing', path, document, options);

  // Write to Firestore
  const write = await admin.firestore().doc(path).set(document, options)
    .catch((e) => e);

  if (write instanceof Error) {
    return ctx.respond(write.message, { code: 500 });
  }

  return ctx.respond({ path });
};
