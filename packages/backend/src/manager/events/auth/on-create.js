const { retryWrite, runAuthHook, MAX_RETRIES } = require('./utils.js');
const { buildUserDoc, isUserDoc, extractProviderName } = require('../../libraries/user-doc.js');

/**
 * onCreate - Create user doc
 *
 * This function fires for ALL user creations (including Admin SDK).
 * It creates the user doc in Firestore.
 *
 * Key behaviors:
 * - Checks if user doc already exists (auth.uid) → skips if exists (handles test accounts, provider linking)
 * - Retries up to 3 times with exponential backoff on failure
 *
 * If the user signed up via a provider (Google, Facebook, etc.), their display name
 * is extracted and stored as personal.name.first/last on the user doc.
 *
 * Non-critical work (welcome emails, marketing contact) is handled
 * by the user/signup endpoint, which the frontend calls after account creation.
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

  // The headline is one line — uid + email. The full UserRecord (passwordHash,
  // providerData, metadata) and the event context stay reachable at debug level.
  ctx.log(`onCreate: ${user.uid} (${user.email})`);
  ctx.debug(`onCreate: ${user.uid} record`, user, context);

  // Skip anonymous users
  if (user.providerData?.every(p => p.providerId === 'anonymous')) {
    ctx.log(`onCreate: Skipping anonymous user ${user.uid} (${Date.now() - startTime}ms)`);
    return;
  }

  // Check if user doc already exists (handles test accounts, provider linking)
  const existingDoc = await admin.firestore().doc(`users/${user.uid}`)
    .get()
    .catch(e => {
      ctx.error(`onCreate: Failed to check existing doc for ${user.uid}:`, e);
      return null;
    });

  if (isUserDoc(existingDoc?.exists ? existingDoc.data() : null)) {
    ctx.log(`onCreate: User doc already exists for ${user.uid}, skipping creation (${Date.now() - startTime}ms)`);
    return;
  }

  // Extract name from provider data (e.g., Google, Facebook, GitHub)
  ctx.log(`onCreate: Inferred name from provider:`, extractProviderName(user));

  // Build the user doc — the same shape the sign-in heal recreates when this doc
  // goes missing later ([#405](https://github.com/Omega-JS-Stack/omega/issues/405))
  const userRecord = buildUserDoc({ Manager: Manager, user: user, tag: 'auth:on-create' });

  // The UID and nothing else. The doc carries the email, the name, the signup IP
  // and the geolocation, and a backend line lands in Cloud Logging for the whole
  // retention window — so none of it rides this line
  // ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
  ctx.log(`onCreate: Creating user doc for ${user.uid}`);

  // Write user doc with retry
  try {
    await retryWrite(ctx, 'onCreate', async () => {
      await admin.firestore().doc(`users/${user.uid}`).set(userRecord);
    });

    ctx.log(`onCreate: Successfully created user doc for ${user.uid} (${Date.now() - startTime}ms)`);
  } catch (error) {
    ctx.error(`onCreate: Failed to create user doc after ${MAX_RETRIES} retries:`, error);

    // Don't reject - the user was already created in Auth
    // The user/signup endpoint will handle creating the doc if it's missing
  }

  // The SERVER half of `sign_up` does NOT fire here
  // ([#577](https://github.com/Omega-JS-Stack/omega/issues/577)). A trigger has
  // no HTTP request behind it, so a registration fired from here reached Meta
  // and TikTok with no IP, no user agent, no platform cookies and an attribution
  // the browser had not posted yet — around 4/10 on Meta's match quality. It
  // fires from `routes/user/signup` instead, the post-auth request that carries
  // all four (`libraries/analytics/signup.js`). Adding it back here would count
  // every registration twice.

  // Run consumer hook (non-blocking — errors logged but don't fail)
  await runAuthHook('on-create', { Manager, ctx, user, context, libraries }).catch(e => {
    ctx.error('onCreate: Consumer hook error:', e);
  });
};

