/**
 * The user doc's BIRTH — the one shape a `users/{uid}` doc is created in, and
 * the heal that recreates it when it went missing behind a real account.
 *
 * A doc is born at signup (auth:on-create). Out-of-sync states happen in the
 * wild, so an auth user whose doc is gone gets it back at the next moment it is
 * needed: sign-in ([#405](https://github.com/Omega-JS-Stack/omega/issues/405)).
 * Both paths build the SAME record here — a heal that hand-rolled its own shape
 * would drift from the one a signup writes the day either side changes.
 *
 * The opposite direction (a doc with no auth user) is never healed: the payment
 * guards refuse it and the users migration cleans it up
 * ([#399](https://github.com/Omega-JS-Stack/omega/issues/399)).
 */

const _ = require('lodash');
const { getAuthUser } = require('./auth-user.js');

// metadata.tag the heal stamps, so a healed doc is findable in the database — it
// is the only tag that says "this account's doc was recreated after the fact".
const HEAL_TAG = 'auth:heal';

// How long after an account is created the heal stands down and leaves the first
// write to auth:on-create (which the signup route already polls for).
const SIGNUP_WINDOW_MS = 120000;

/**
 * Whether a users/{uid} doc is a REAL user doc rather than residue
 *
 * `auth.uid` is what a birth writes and what nothing else does: auth:before-signin
 * merge-writes activity onto users/{uid} on every sign-in, so a doc-less account
 * already HAS a doc by the time a request arrives — one holding nothing but
 * activity. Existence alone reads that as an account.
 *
 * @param {object|null} data - The doc data, or null when the doc does not exist
 * @returns {boolean}
 */
function isUserDoc(data) {
  return !!data?.auth?.uid;
}

/**
 * Build the user doc for a Firebase Auth user record
 *
 * @param {object} Manager - The booted Manager (owns the User schema + Metadata)
 * @param {object} user - The firebase-admin UserRecord the doc belongs to
 * @param {string} tag - metadata.tag naming the seam writing it
 * @returns {object} The complete user doc, ready to write
 */
function buildUserDoc({ Manager, user, tag }) {
  const providerName = extractProviderName(user);

  // Create user record using Manager.User() helper
  const userRecord = Manager.User({
    auth: {
      uid: user.uid,
      email: user.email,
    },
    personal: providerName ? {
      name: providerName,
    } : undefined,
  }).properties;

  // Add metadata tag (merge into existing metadata to preserve metadata.created from User schema)
  const meta = Manager.Metadata().set({ tag: tag });
  userRecord.metadata = { ...userRecord.metadata, ...meta };

  // Stamp metadata.created from Firebase Auth's creationTime (the canonical account-creation
  // moment) rather than the User schema's "now" — otherwise the doc lands a beat after Auth,
  // and the OMEGA user migration reconciles every new signup against Auth on its next run.
  const creationTime = user.metadata?.creationTime;
  if (creationTime) {
    const createdDate = new Date(creationTime);
    userRecord.metadata.created = {
      timestamp: createdDate.toISOString(),
      timestampUNIX: Math.round(createdDate.getTime() / 1000),
    };
  }

  return userRecord;
}

/**
 * Recreate a missing user doc for a signed-in caller
 *
 * Idempotent: the write runs in a transaction, so whichever of the two writers
 * arrives second finds the doc and leaves it alone. One doc per uid, never a
 * duplicate account, whichever order the two land in:
 *   - on-create first → the transaction reads a real doc and writes nothing.
 *   - heal first → on-create's own "already exists" check skips it.
 * The signup window below keeps that second order off a brand-new account
 * entirely, so on-create's write stays the authoritative one for every real
 * signup. Existing values win over the freshly generated schema defaults, so
 * nothing already on the doc (before-signin's activity, an api key) is clobbered.
 *
 * @param {object} Manager - The booted Manager
 * @param {object} ctx - The RouteContext to log through
 * @param {object} admin - The firebase-admin app
 * @param {string} uid - The uid whose doc is missing
 * @returns {Promise<object|null>} The doc that now exists, or null when there was nothing to heal
 */
async function healUserDoc({ Manager, ctx, admin, uid }) {
  // The auth user is the proof the doc SHOULD exist. A verified ID token outlives
  // a deleted account by up to an hour, and recreating a doc for one would mint
  // exactly the auth-less zombie the payment guards refuse (#399).
  const authUser = await getAuthUser(admin, uid);

  if (!authUser) {
    ctx.warn(`Not healing users/${uid}: the ID token verifies but the account no longer exists in Auth`);
    return null;
  }

  // Anonymous accounts get no user doc anywhere in the framework. The same rule
  // auth:on-create applies, read off the same record — an account with no
  // providerData at all is an anonymous sign-in.
  if (isAnonymous(authUser)) {
    ctx.log(`Not healing users/${uid}: anonymous accounts get no user doc`);
    return null;
  }

  // A signup still in flight belongs to auth:on-create, not here. Its write is
  // what fires the server half of sign_up and runs the consumer hook, and a heal
  // that got there first would take that job away: on-create's own "already
  // exists" check would then skip the account for good. Inside the window a
  // doc-less caller is answered exactly as it was before the heal existed, and
  // the signup route is already polling for the doc it is waiting on.
  const age = accountAge(authUser);

  if (age !== null && age < SIGNUP_WINDOW_MS) {
    ctx.log(`Not healing users/${uid}: the account is ${Math.round(age / 1000)}s old, so auth:on-create still owns its first write`);
    return null;
  }

  const record = buildUserDoc({ Manager: Manager, user: authUser, tag: HEAL_TAG });

  // A healed account signed up long ago, so its signup flow is long over. Leaving
  // flags.signupProcessed false sends the next page load back through all of it
  // (welcome emails, affiliate credit, marketing sync) against an established
  // account. Stamped on the heal path ONLY — a real new signup still has that
  // flow ahead of it, so what auth:on-create writes is unchanged.
  // Assumes the residue the merge below preserves carries no flags of its own:
  // existing values win there, so a doc-less account that somehow arrived with
  // flags.signupProcessed=false would keep it. Nothing writes flags onto a
  // doc-less account today (before-signin writes metadata + activity, nothing else).
  record.flags = { ...record.flags, signupProcessed: true };

  const ref = admin.firestore().doc(`users/${uid}`);

  const result = await admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() : null;

    // Somebody won the race — a doc that is already real is left exactly as it is
    if (isUserDoc(existing)) {
      return { doc: existing, wrote: false };
    }

    // Deepest-first: the schema-complete record, then whatever residue the doc
    // already carries (real values win over defaults). _.merge mutates its first
    // arg, so start from a fresh object.
    const merged = _.merge({}, record, existing || {});

    transaction.set(ref, merged);

    return { doc: merged, wrote: true };
  });

  if (result.wrote) {
    // Loud on purpose: a signed-in account with no doc is a database out of sync
    // with Auth, and silence here would hide every one of them.
    ctx.warn(`Healed users/${uid}: a verified caller had no user doc, so it was recreated from the Auth record (tag=${HEAL_TAG})`);
  } else {
    ctx.log(`No heal needed for users/${uid}: the doc was written while the heal was running`);
  }

  return result.doc;
}

/**
 * Whether an Auth record is an anonymous sign-in, exactly as auth:on-create reads it
 *
 * An account with an EMPTY providerData qualifies: nothing federated and no
 * password is what an anonymous sign-in leaves behind.
 *
 * @param {object} user - The firebase-admin UserRecord
 * @returns {boolean}
 */
function isAnonymous(user) {
  return !!user.providerData?.every((p) => p.providerId === 'anonymous');
}

/**
 * How long ago Firebase Auth created this account, in ms
 *
 * A future-dated creationTime (an imported record carrying a skewed clock) reads
 * as in-window forever, so such an account is never healed. Assumed acceptable:
 * that is the pre-heal status quo for it, and Auth stamps its own clock on every
 * account created the normal way.
 *
 * @param {object} user - The firebase-admin UserRecord
 * @returns {number|null} The age, or null when the record carries no usable
 *   creationTime — nothing to judge the signup window by, so the heal proceeds
 */
function accountAge(user) {
  const created = new Date(user.metadata?.creationTime || '').getTime();

  return Number.isNaN(created) ? null : Date.now() - created;
}

/**
 * Extract first/last name from provider data (Google, Facebook, GitHub, etc.)
 * Returns { first, last } or null if no name found
 */
function extractProviderName(user) {
  // Try provider-specific displayName first, then top-level displayName
  const displayName = user.providerData?.find(p =>
    p.providerId !== 'password'
    && p.providerId !== 'anonymous'
    && p.displayName
  )?.displayName || user.displayName;

  if (!displayName) {
    return null;
  }

  const parts = displayName.trim().split(/\s+/);

  return {
    first: parts[0] || null,
    last: parts.slice(1).join(' ') || null,
  };
}

module.exports = { buildUserDoc, healUserDoc, isUserDoc, extractProviderName, HEAL_TAG, SIGNUP_WINDOW_MS };
