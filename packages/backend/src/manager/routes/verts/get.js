/**
 * GET /omega/verts - List or get house verts
 * Admin-only. Used by the admin dashboard.
 *
 * Query params:
 *   id    — Get a single vert by ID
 *   limit — Max results (default 100)
 */
module.exports = async ({ assistant, user, Manager, settings }) => {

  if (!user.authenticated) {
    return assistant.respond('Authentication required', { code: 401 });
  }
  if (!user.roles.admin) {
    return assistant.respond('Admin access required', { code: 403 });
  }

  const { admin } = Manager.libraries;

  // Single vert by ID
  if (settings.id) {
    const doc = await admin.firestore().doc(`verts/${settings.id}`).get();

    if (!doc.exists) {
      return assistant.respond('Vert not found', { code: 404 });
    }

    return assistant.respond({
      success: true,
      vert: { id: doc.id, ...doc.data() },
    });
  }

  // List verts
  const snapshot = await admin.firestore().collection('verts')
    .limit(parseInt(settings.limit, 10) || 100)
    .get();

  const verts = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  return assistant.respond({
    success: true,
    verts,
    count: verts.length,
  });
};
