const { retryWrite, runAuthHook, MAX_RETRIES } = require('./utils.js');
const { buildUserDoc, isUserDoc, extractProviderName } = require('../../libraries/user-doc.js');
const { deliverConversion } = require('../../libraries/analytics/conversions.js');
const { buildAttributionContext, buildIdentity } = require('../../libraries/analytics/match-data.js');

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

  ctx.log(`onCreate: Creating user doc for ${user.uid}`, userRecord);

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

  // The server half of sign_up (non-blocking)
  trackSignup({ Manager, ctx, user, userRecord });

  // Run consumer hook (non-blocking — errors logged but don't fail)
  await runAuthHook('on-create', { Manager, ctx, user, context, libraries }).catch(e => {
    ctx.error('onCreate: Consumer hook error:', e);
  });
};

/**
 * Fire the SERVER half of `sign_up` — the account truth, straight from the
 * moment Auth created it ([#385](https://github.com/Omega-JS-Stack/omega/issues/385),
 * inventory gap 2: this event had only its browser half).
 *
 * `sign_up` is the catalog's one `placement: 'both'` event, so the two halves
 * MUST deduplicate or every registration is counted twice.
 *
 *   THE DEDUPE ID IS `sign_up.<uid>`.
 *
 * Meta's Conversions API deduplicates on the PAIR (`event_name`, `event_id`), and
 * TikTok on `event_id` — so both halves have to name the same string, computed
 * from something both sides hold before either fires. The uid is the only such
 * thing: the browser has it the instant Firebase Auth resolves (it is what the
 * client's `trackSignup(method, user)` already reads), the server has it on the
 * trigger, and it is unique per account for all time. Nothing derived from a
 * clock could ever match across the two.
 *
 * The client half is stage E's ([#386](https://github.com/Omega-JS-Stack/omega/issues/386)):
 * it fires `sign_up` with the same id, and the platforms count ONE registration.
 *
 * Which is why this half is META + TIKTOK ONLY: GA4 has no cross-source event_id
 * deduplication, so a Measurement Protocol `sign_up` beside the browser's gtag
 * `sign_up` is simply two registrations. GA4 keeps its mapping in the catalog —
 * the client half owns that provider (Ian's ruling, stage D).
 *
 * Attribution and the consent snapshot come off the record being written. In
 * practice this trigger runs BEFORE `/user/signup` (which is what stores the
 * campaign the browser captured), so the server half usually carries identity
 * alone while the browser half carries the campaign — which is exactly the
 * division of labour the two halves exist for. Absent match data never blocks a
 * fire: an external_id-only registration still reaches the platforms.
 */
function trackSignup({ Manager, ctx, user, userRecord }) {
  try {
    deliverConversion({
      event: 'sign_up',
      params: {
        method: resolveSignupMethod(user),
        user_id: user.uid,
      },
      attribution: buildAttributionContext(userRecord.attribution),
      identity: buildIdentity({
        uid: user.uid,
        email: user.email,
        telephone: user.phoneNumber,
      }),
      trackingConsent: userRecord.trackingConsent,
      // The two providers that deduplicate on event_id (see the header) — GA4 is
      // the client half's to fire.
      providers: ['meta', 'tiktok'],
      eventId: `sign_up.${user.uid}`,
      ctx,
      Manager,
    });
  } catch (e) {
    ctx.error(`onCreate: sign_up tracking failed for ${user.uid}:`, e);
  }
}

/**
 * How this account was created, in the same vocabulary the browser half sends:
 * 'email' for a password signup, otherwise the provider's own name ('google',
 * 'facebook', …) rather than its Firebase id ('google.com').
 */
function resolveSignupMethod(user) {
  const providerId = user.providerData?.[0]?.providerId;

  if (!providerId || providerId === 'password') {
    return 'email';
  }

  return providerId.replace(/\.com$/, '');
}

// Exported for testing — the signup method vocabulary is a contract with the
// browser half of the event, not an internal detail
module.exports.resolveSignupMethod = resolveSignupMethod;
