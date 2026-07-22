const uuid4 = require('uuid').v4;
const UIDGenerator = require('uid-generator');
const powertools = require('node-powertools');
const uidgen = new UIDGenerator(256);

/**
 * POST /user/api-keys - Regenerate API keys
 * Regenerates clientId and/or privateKey for the user
 */
module.exports = async ({ ctx, Manager, user, settings, libraries }) => {
  const { admin } = libraries;

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Get target UID
  const uid = settings.uid;

  // Require admin to regenerate other users' keys
  if (uid !== user.auth.uid && !user.roles.admin) {
    return ctx.respond('Admin required', { code: 403 });
  }

  // Determine which keys to regenerate
  const keys = powertools.arrayify(settings.keys);
  const newKeys = {};

  keys.forEach((key) => {
    if (key.match(/client/i)) {
      newKeys.clientId = uuid4();
    } else if (key.match(/private/i)) {
      newKeys.privateKey = uidgen.generateSync();
    }
  });

  // Update user document
  const write = await admin.firestore().doc(`users/${uid}`)
    .set({
      api: newKeys,
      metadata: Manager.Metadata().set({ tag: 'user/api-keys' }),
    }, { merge: true })
    .catch((e) => e);

  if (write instanceof Error) {
    return ctx.respond(`Failed to generate keys: ${write}`, { code: 500 });
  }

  return ctx.respond(newKeys);
};
