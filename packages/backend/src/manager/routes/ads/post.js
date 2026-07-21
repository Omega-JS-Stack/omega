/**
 * POST /omega/ads - Create a house ad
 * Admin-only. Saves to the ads collection (the serve route's inventory).
 */
const { isHttpUrl, resetInventoryCache } = require('./utils.js');

module.exports = async ({ assistant, user, Manager, settings, analytics }) => {

  if (!user.authenticated) {
    return assistant.respond('Authentication required', { code: 401 });
  }
  if (!user.roles.admin) {
    return assistant.respond('Admin access required', { code: 403 });
  }

  if (!isHttpUrl(settings.link)) {
    return assistant.respond('link must be a valid http(s) URL', { code: 400 });
  }

  const { admin } = Manager.libraries;
  const adId = settings.id;

  const doc = {
    id: adId,
    enabled: settings.enabled,
    title: settings.title,
    description: settings.description,
    button: settings.button,
    link: settings.link,
    image: settings.image,
    footer: settings.footer,
    weight: settings.weight,
    targeting: settings.targeting,
    whitelist: settings.whitelist,
    blacklist: settings.blacklist,
    metadata: {
      created: {
        timestamp: assistant.meta.startTime.timestamp,
        timestampUNIX: assistant.meta.startTime.timestampUNIX,
      },
      updated: {
        timestamp: assistant.meta.startTime.timestamp,
        timestampUNIX: assistant.meta.startTime.timestampUNIX,
      },
    },
  };

  await admin.firestore().doc(`ads/${adId}`).set(doc);

  // Same-instance inventory freshness
  resetInventoryCache();

  assistant.log('ads created:', { adId });

  analytics.event('ads', { action: 'create' });

  return assistant.respond({
    success: true,
    ad: { ...doc },
  });
};
