/**
 * DELETE /omega/verts - Delete a house vert
 * Admin-only.
 */
const { resetInventoryCache } = require('./utils.js');

module.exports = async ({ assistant, user, Manager, settings, analytics }) => {

  if (!user.authenticated) {
    return assistant.respond('Authentication required', { code: 401 });
  }
  if (!user.roles.admin) {
    return assistant.respond('Admin access required', { code: 403 });
  }

  const { admin } = Manager.libraries;
  const vertId = (settings.id || '').trim();

  if (!vertId) {
    return assistant.respond('Vert ID is required', { code: 400 });
  }

  const docRef = admin.firestore().doc(`verts/${vertId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return assistant.respond('Vert not found', { code: 404 });
  }

  await docRef.delete();

  // Same-instance inventory freshness
  resetInventoryCache();

  assistant.log('verts deleted:', { vertId });

  analytics.event('verts', { action: 'delete' });

  return assistant.respond({
    success: true,
    deleted: vertId,
  });
};
