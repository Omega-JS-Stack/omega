const { retryWrite, runAuthHook, MAX_RETRIES } = require('./utils.js');
const { deliverConversion } = require('../../libraries/analytics/conversions.js');
const { buildAttributionContext, buildIdentity } = require('../../libraries/analytics/match-data.js');

/**
 * onDelete - Delete user doc
 *
 * This function fires when a user is deleted from Firebase Auth.
 * It deletes the user doc from Firestore.
 *
 * Key behaviors:
 * - Checks if user doc exists before attempting delete
 * - Retries up to 3 times with exponential backoff on failure
 * - Logs timing for performance monitoring
 *
 * Available parameters (1st gen):
 *
 * user (UserRecord — firebase-admin):
 *   uid, email, emailVerified, displayName, photoURL, phoneNumber, disabled,
 *   metadata: { creationTime, lastSignInTime, lastRefreshTime },
 *   providerData: [{ uid, displayName, email, photoURL, providerId, phoneNumber }],
 *   passwordHash, passwordSalt, customClaims, tenantId, tokensValidAfterTime, multiFactor
 *
 * context (EventContext — NOT AuthEventContext, no ipAddress/userAgent/locale):
 *   eventId, eventType, timestamp, resource: { service, name }, params
 */
module.exports = async ({ Manager, ctx, user, context, libraries }) => {
  const startTime = Date.now();
  const { admin } = libraries;

  ctx.log(`onDelete: ${user.uid} (${user.email})`, user, context);

  // Check if user doc exists before attempting delete
  const existingDoc = await admin.firestore().doc(`users/${user.uid}`)
    .get()
    .catch(e => {
      ctx.error(`onDelete: Failed to check existing doc for ${user.uid}:`, e);
      return null;
    });

  if (!existingDoc || !existingDoc.exists) {
    ctx.log(`onDelete: User doc does not exist for ${user.uid}, skipping (${Date.now() - startTime}ms)`);
    return;
  }

  // Read the doc BEFORE it goes: the consent snapshot and the campaign that won
  // this account are the only record of either, and the delete below is the
  // moment they stop existing.
  const userDoc = existingDoc.data();

  // Delete user doc with retry
  try {
    await retryWrite(ctx, 'onDelete', async () => {
      await admin.firestore().doc(`users/${user.uid}`).delete();
    });

    ctx.log(`onDelete: Successfully deleted user doc for ${user.uid}`);
  } catch (error) {
    ctx.error(`onDelete: Failed to delete user doc after ${MAX_RETRIES} retries:`, error);

    // Don't reject - the user was already deleted from Auth
    // Just log the error and continue
    return;
  }

  // Remove marketing contact from all providers (non-blocking)
  if (user.email) {
    const email = Manager.Email(ctx);
    email.remove(user.email)
      .then((r) => ctx.log('onDelete: Marketing remove:', r))
      .catch((e) => ctx.error('onDelete: Marketing remove failed:', e));
  }

  // Send delete analytics (server-side only event)
  trackDelete({ Manager, ctx, user, userDoc });

  // Run consumer hook (non-blocking — errors logged but don't fail)
  await runAuthHook('on-delete', { Manager, ctx, user, context, libraries }).catch(e => {
    ctx.error('onDelete: Consumer hook error:', e);
  });

  ctx.log(`onDelete: Completed for ${user.uid} (${Date.now() - startTime}ms)`);
};

/**
 * Fire the canonical `user_delete` conversion (non-blocking).
 *
 * The same treatment `notification_subscribe` gets, and for the same reason: a
 * raw `Manager.Analytics(...).event()` reaches GA4 without ever asking the
 * consent gate, and names an event no catalog knows. `user_delete` is a
 * `placement: 'server'`, GA4-only entry — nothing else can observe an account
 * ending, and no ad platform has anything to do with it.
 *
 * THE DEDUPE ID IS `user_delete.<uid>` — an account is deleted once, and the
 * uid is what the deletion is about, so a redelivered trigger reports the same
 * event rather than a second one.
 *
 * The consent snapshot and the attribution come off the doc read BEFORE the
 * delete — the last moment either exists. An ABSENT snapshot grants: a legacy
 * account predating the consent system still gets counted, which is the
 * standing rule for every server conversion (conversions.js).
 *
 * @param {object} options
 * @param {object} options.Manager - The backend Manager.
 * @param {object} options.ctx - The event context.
 * @param {object} options.user - The deleted Auth UserRecord.
 * @param {object} [options.userDoc] - The user doc as it stood before deletion.
 * @returns {void}
 */
function trackDelete({ Manager, ctx, user, userDoc }) {
  try {
    deliverConversion({
      event: 'user_delete',
      attribution: buildAttributionContext(userDoc?.attribution),
      identity: buildIdentity({ uid: user.uid }),
      trackingConsent: userDoc?.trackingConsent,
      eventId: `user_delete.${user.uid}`,
      ctx: ctx,
      Manager: Manager,
    });
  } catch (e) {
    ctx.error(`onDelete: user_delete tracking failed for ${user.uid}:`, e);
  }
}
