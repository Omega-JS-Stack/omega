/**
 * DELETE /omega/ads - Delete a house ad
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
  const adId = (settings.id || '').trim();

  if (!adId) {
    return assistant.respond('Ad ID is required', { code: 400 });
  }

  const docRef = admin.firestore().doc(`ads/${adId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return assistant.respond('Ad not found', { code: 404 });
  }

  await docRef.delete();

  // Same-instance inventory freshness
  resetInventoryCache();

  assistant.log('ads deleted:', { adId });

  analytics.event('ads', { action: 'delete' });

  return assistant.respond({
    success: true,
    deleted: adId,
  });
};
