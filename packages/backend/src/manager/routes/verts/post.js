/**
 * POST /omega/verts - Create a house vert
 * Admin-only. Saves to the verts collection (the serve route's inventory).
 */
const { isHttpUrl, resetInventoryCache } = require('./utils.js');

module.exports = async ({ ctx, user, Manager, settings, analytics }) => {

  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }
  if (!user.roles.admin) {
    return ctx.respond('Admin access required', { code: 403 });
  }

  if (!isHttpUrl(settings.link)) {
    return ctx.respond('link must be a valid http(s) URL', { code: 400 });
  }

  const { admin } = Manager.libraries;
  const vertId = settings.id;

  const doc = {
    id: vertId,
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
        timestamp: ctx.meta.startTime.timestamp,
        timestampUNIX: ctx.meta.startTime.timestampUNIX,
      },
      updated: {
        timestamp: ctx.meta.startTime.timestamp,
        timestampUNIX: ctx.meta.startTime.timestampUNIX,
      },
    },
  };

  await admin.firestore().doc(`verts/${vertId}`).set(doc);

  // Same-instance inventory freshness
  resetInventoryCache();

  ctx.log('verts created:', { vertId });

  analytics.event('verts', { action: 'create' });

  return ctx.respond({
    success: true,
    vert: { ...doc },
  });
};
