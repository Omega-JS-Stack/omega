/**
 * PUT /omega/ads - Update a house ad
 * Admin-only. Only provided fields are updated; id and metadata.created
 * are immutable.
 */
const { isHttpUrl, resetInventoryCache } = require('./utils.js');

// Fields a PUT may update (id + metadata are immutable)
const EDITABLE_FIELDS = ['enabled', 'title', 'description', 'button', 'link', 'image', 'footer', 'weight', 'targeting', 'whitelist', 'blacklist'];

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

  // Presence comes from the RAW request data (the schema engine coerces
  // absent fields to type-empty values, so settings alone can't distinguish
  // "absent" from "cleared")
  const provided = Object.keys(assistant.request.data || {});

  if (provided.includes('link') && !isHttpUrl(settings.link)) {
    return assistant.respond('link must be a valid http(s) URL', { code: 400 });
  }

  const docRef = admin.firestore().doc(`ads/${adId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return assistant.respond('Ad not found', { code: 404 });
  }

  // Build update from provided fields only
  const update = {
    metadata: {
      updated: {
        timestamp: assistant.meta.startTime.timestamp,
        timestampUNIX: assistant.meta.startTime.timestampUNIX,
      },
    },
  };

  for (const field of EDITABLE_FIELDS) {
    if (provided.includes(field) && settings[field] !== undefined) {
      update[field] = settings[field];
    }
  }

  await docRef.set(update, { merge: true });

  // Same-instance inventory freshness
  resetInventoryCache();

  assistant.log('ads updated:', { adId, update });

  analytics.event('ads', { action: 'update' });

  // Fetch updated doc
  const updated = await docRef.get();

  return assistant.respond({
    success: true,
    ad: { id: adId, ...updated.data() },
  });
};
