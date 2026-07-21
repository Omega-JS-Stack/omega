/**
 * GET /omega/ads - List or get house ads
 * Admin-only. Used by the admin dashboard.
 *
 * Query params:
 *   id    — Get a single ad by ID
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

  // Single ad by ID
  if (settings.id) {
    const doc = await admin.firestore().doc(`ads/${settings.id}`).get();

    if (!doc.exists) {
      return assistant.respond('Ad not found', { code: 404 });
    }

    return assistant.respond({
      success: true,
      ad: { id: doc.id, ...doc.data() },
    });
  }

  // List ads
  const snapshot = await admin.firestore().collection('ads')
    .limit(parseInt(settings.limit, 10) || 100)
    .get();

  const ads = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  return assistant.respond({
    success: true,
    ads,
    count: ads.length,
  });
};
