/**
 * Users collection migration: converges every user document to the
 * @omega.js/account user schema, whose record, validation shape and null
 * defaults lib/user-schema.js derives. Fix order is load-bearing: the moves and
 * the consent/attribution backfills run ahead of the defaults backfill, which
 * would otherwise write the empty values they read; dynamic values
 * (affiliate.code, api.*) are minted per document after it. One company's
 * historical damage repairs stay in omega-manager: this converges the schema.
 */
const { randomUUID, randomBytes } = require('node:crypto');

const { runMigration, FieldValue } = require('../lib/migration-runner.js');
const { createMetadataFix } = require('../lib/ensure-metadata.js');
const { validateDocument } = require('../lib/schema-validator.js');
const { createSanitizeFix } = require('../lib/sanitize-strings.js');
const { createAttributionFoldFix } = require('../lib/attribution-touch.js');
const { DEFAULT_USER, USER_VALIDATION, RESET_DEFAULTS, nullableStringFields } = require('../lib/user-schema.js');

// The branches whose legacy defaults wrote '' and the old sentinels
const SENTINEL_FIELDS = [...nullableStringFields('activity'), ...nullableStringFields('personal')];

/**
 * Generate a random alphanumeric ID (matches nanoid with URL-safe alphabet minus _ and -)
 */
function generateId(size = 7) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = randomBytes(size);
  let result = '';
  for (let i = 0; i < size; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

/**
 * Deep merge defaults under existing data (existing values take precedence)
 */
function deepMergeDefaults(existing, defaults) {
  const result = { ...defaults };

  for (const [key, value] of Object.entries(existing)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
      result[key] = deepMergeDefaults(value, defaults[key]);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Deep equality check (key-order insensitive)
 */
function deepEqual(a, b) {
  if (a === b) {
    return true;
  }

  if (a === null || b === null || typeof a !== typeof b) {
    return false;
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) {
      return false;
    }
    return keysA.every((key) => key in b && deepEqual(a[key], b[key]));
  }

  return false;
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str) {
  if (!str) {
    return '';
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Users collection migration handler.
 *
 * @param {Object} context - Handler context (authAdmin + firestore from setup)
 * @returns {Object} Migration results
 */
module.exports = async function ensureUsers(context) {
  const { brandId, brandConfig, authAdmin } = context;

  // Cache auth lookups to avoid redundant API calls within a single migration run
  const authCache = new Map();

  // Cache affiliate code lookups: UID → affiliateCode or null
  const affiliateCache = new Map();

  /**
   * Resolve a UID to the user's affiliate.code via DB lookup (cached).
   * Returns the affiliate code string, or null if user not found / has no code.
   */
  async function resolveAffiliateCode(db, uid) {
    if (affiliateCache.has(uid)) {
      return affiliateCache.get(uid);
    }

    try {
      const referrer = await db.getDoc(`users/${uid}`);
      const code = referrer?.affiliate?.code || null;
      affiliateCache.set(uid, code);
      return code;
    } catch {
      affiliateCache.set(uid, null);
      return null;
    }
  }

  return runMigration(context, {
    collection: 'users',

    fixes: [
      // Fix 0: Delete orphaned user docs (no matching Firebase Auth user).
      // Caches the user record (or null) so later fixes can read metadata.creationTime.
      async (data, doc) => {
        const uid = data.auth?.uid || doc.id;

        if (authCache.has(uid)) {
          return authCache.get(uid) ? null : { __delete__: true, reason: 'orphaned auth user' };
        }

        const MAX_RETRIES = 5;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const userRecord = await authAdmin.getUser(uid);
            authCache.set(uid, userRecord);
            return userRecord ? null : { __delete__: true, reason: 'orphaned auth user' };
          } catch (error) {
            // Retry on transient errors; missing users are a null return, not a throw
            if (attempt < MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, 1000 * attempt));
              continue;
            }
            throw error;
          }
        }
      },

      // Fix 1: plan → subscription
      (data) => {
        if (data.plan === undefined) {
          return null;
        }

        const updates = { plan: FieldValue.delete() };

        // Merge plan into subscription (subscription takes precedence if both exist)
        if (data.subscription === undefined) {
          updates.subscription = data.plan;
        }

        return updates;
      },

      // Fix 2: subscription.id (flat string) → subscription.product (object)
      (data) => {
        if (!data.subscription || typeof data.subscription.id !== 'string') {
          return null;
        }

        const id = data.subscription.id;
        const name = (typeof data.subscription.name === 'string')
          ? data.subscription.name
          : capitalize(id);

        const updates = {
          'subscription.product': { id, name },
          'subscription.id': FieldValue.delete(),
        };

        if (typeof data.subscription.name === 'string') {
          updates['subscription.name'] = FieldValue.delete();
        }

        return updates;
      },

      // Fix 3: trial.activated → trial.claimed
      (data) => {
        if (data.subscription?.trial?.activated === undefined) {
          return null;
        }
        return {
          'subscription.trial.claimed': data.subscription.trial.activated,
          'subscription.trial.activated': FieldValue.delete(),
        };
      },

      // Fix 4: oauth2 → connections, each record stamped with its KIND
      // ([#788](https://github.com/Omega-JS-Stack/omega/issues/788)), and every
      // record carrying the `identity.id` the connections route matches on
      // ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)). The
      // product concept is a CONNECTION and a connection will not always be an
      // OAuth grant, so the field carries the product word and every record
      // says which kind it is. The original is deleted in the same write (the
      // standing ruling on moved fields). Both keys present keeps `connections`
      // (written by current code, so newer) and drops the leftover, the same
      // rule `payment-provider` follows.
      //
      // The BACKFILL runs over an existing `connections` map too, not only over
      // what this run moves: the rename shipped before the id did, so a document
      // moved by the #788 code has no `oauth2` left to trigger anything and
      // would never gain one. A document that needs neither the move nor the
      // backfill writes nothing at all.
      (data) => {
        const hasLegacy = data.oauth2 !== undefined;
        const existing = (data.connections && typeof data.connections === 'object') ? data.connections : {};

        if (!hasLegacy && Object.keys(existing).length === 0) {
          return null;
        }

        const legacy = (data.oauth2 && typeof data.oauth2 === 'object') ? data.oauth2 : {};
        const moved = { ...existing };

        for (const [provider, record] of Object.entries(legacy)) {
          if (provider in moved) {
            continue;
          }

          moved[provider] = (record && typeof record === 'object')
            ? { ...record, type: 'oauth2' }
            : record;
        }

        // A record written before the id existed carries whatever its provider
        // answered: Google's `sub`, Kick's numeric `user_id`. The id is filled
        // in beside them — as a STRING, which is what the query compares — and
        // nothing is deleted: the identity is stored as the provider gave it.
        let backfilled = false;

        for (const [provider, record] of Object.entries(moved)) {
          if (!record || typeof record !== 'object') {
            continue;
          }

          const identity = record.identity;

          if (!identity || typeof identity !== 'object' || typeof identity.id === 'string') {
            continue;
          }

          const stableId = identity.sub ?? identity.user_id ?? identity.id;

          if (stableId === undefined || stableId === null || stableId === '') {
            continue;
          }

          // A COPY, never a mutation of the document data this audit is reading
          moved[provider] = { ...record, identity: { ...identity, id: `${stableId}` } };
          backfilled = true;
        }

        if (!hasLegacy) {
          return backfilled ? { connections: moved } : null;
        }

        return { connections: moved, oauth2: FieldValue.delete() };
      },

      // Fix 5: Remove deprecated fields
      (data) => {
        const updates = {};
        let hasUpdates = false;

        if (data.subscription?.payment?.active !== undefined) {
          updates['subscription.payment.active'] = FieldValue.delete();
          hasUpdates = true;
        }

        if (data.subscription?.limits !== undefined) {
          updates['subscription.limits'] = FieldValue.delete();
          hasUpdates = true;
        }

        if (data.subscription?.payment?.ignoreUntil !== undefined) {
          updates['subscription.payment.ignoreUntil'] = FieldValue.delete();
          hasUpdates = true;
        }

        if (data.subscription?.payment?.method !== undefined) {
          updates['subscription.payment.method'] = FieldValue.delete();
          hasUpdates = true;
        }

        if (data.subscription?.trial?.date !== undefined) {
          updates['subscription.trial.date'] = FieldValue.delete();
          hasUpdates = true;
        }

        if (data.affiliate?.referredBy !== undefined) {
          updates['affiliate.referredBy'] = FieldValue.delete();
          hasUpdates = true;
        }

        return hasUpdates ? updates : null;
      },

      // Fix 6: Fix affiliate.referrals from object to array,
      // and migrate affiliate.referrer → attribution.affiliate.code
      // NOTE: affiliate.referrer stored the referrer's UID, not their affiliate code.
      // We resolve the UID to the actual affiliate code via DB lookup.
      async (data, doc, db) => {
        const updates = {};
        let hasUpdates = false;

        if (data.affiliate?.referrals && !Array.isArray(data.affiliate.referrals)) {
          updates['affiliate.referrals'] = [];
          hasUpdates = true;
        }

        if (data.affiliate?.referrer !== undefined) {
          // Migrate to attribution.affiliate.code if not already set
          if (data.affiliate.referrer && !data.attribution?.affiliate?.code) {
            const resolved = await resolveAffiliateCode(db, data.affiliate.referrer);
            if (resolved) {
              updates['attribution.affiliate.code'] = resolved;
            }
          }
          updates['affiliate.referrer'] = FieldValue.delete();
          hasUpdates = true;
        }

        return hasUpdates ? updates : null;
      },

      // Fix 7: Migrate legacy timestamps → metadata.created/updated
      // Falls back to the document's server createTime/updateTime if no legacy fields exist
      createMetadataFix({
        legacyCreatedFields: ['activity.created', 'created'],
        legacyUpdatedFields: ['activity.lastActivity', 'updated'],
      }),

      // Fix 8: Reconcile metadata.created against Firebase Auth's creationTime.
      // Auth is the canonical source for account creation — if the doc's value differs,
      // overwrite with auth's. The user record was cached in Fix 0 so no extra API call.
      (data, doc) => {
        const uid = data.auth?.uid || doc.id;
        const userRecord = authCache.get(uid);
        const creationTime = userRecord?.metadata?.creationTime;
        if (!creationTime) {
          return null;
        }

        const authDate = new Date(creationTime);
        const authUNIX = Math.round(authDate.getTime() / 1000);
        const currentUNIX = data.metadata?.created?.timestampUNIX;

        if (currentUNIX === authUNIX) {
          return null;
        }

        return {
          'metadata.created.timestamp': authDate.toISOString(),
          'metadata.created.timestampUNIX': authUNIX,
        };
      },

      // Fix 9: Backfill auth.uid and auth.email from Firebase Auth when missing.
      // Some users end up in Firestore without the signup trigger ever running
      // (trigger silently dropped at create time, or the doc was incrementally
      // built by middleware writes only). Firebase Auth is the canonical source —
      // use the cached user record from Fix 0 to backfill.
      (data, doc) => {
        const uid = data.auth?.uid || doc.id;
        const userRecord = authCache.get(uid);
        if (!userRecord) {
          return null;
        }

        const updates = {};
        if (!data.auth?.uid) {
          updates['auth.uid'] = uid;
        }
        if (!data.auth?.email && userRecord.email) {
          updates['auth.email'] = userRecord.email;
        }

        return Object.keys(updates).length > 0 ? updates : null;
      },

      // Fix 10: Flatten personal.company from string to object
      (data) => {
        if (typeof data.personal?.company !== 'string') {
          return null;
        }
        return {
          personal: {
            ...data.personal,
            company: { name: data.personal.company || null, position: null },
          },
        };
      },

      // Fix 11: Backfill consent for existing users (implicit grant at signup).
      // Runs before the defaults backfill so derived values aren't overwritten
      // by DEFAULT_USER nulls. metadata.created is finalized by Fix 7/8;
      // activity.geolocation.ip is on the doc or null.
      (data) => {
        if (data.consent?.legal?.status === 'granted') {
          return null;
        }

        const createdTimestamp = data.metadata?.created?.timestamp || null;
        const createdTimestampUNIX = data.metadata?.created?.timestampUNIX || null;
        const ip = data.activity?.geolocation?.ip || null;
        const brandName = brandConfig?.brand?.name || brandId;
        const legalText = `I agree to ${brandName}'s Terms of Service and Privacy Policy.`;
        const marketingText = `I agree to receive product updates, newsletters, and marketing communications from ${brandName}. You can unsubscribe anytime.`;

        return {
          'consent.legal.status': 'granted',
          'consent.legal.grantedAt.timestamp': createdTimestamp,
          'consent.legal.grantedAt.timestampUNIX': createdTimestampUNIX,
          'consent.legal.grantedAt.source': 'signup',
          'consent.legal.grantedAt.ip': ip,
          'consent.legal.grantedAt.text': legalText,
          'consent.marketing.status': 'granted',
          'consent.marketing.grantedAt.timestamp': createdTimestamp,
          'consent.marketing.grantedAt.timestampUNIX': createdTimestampUNIX,
          'consent.marketing.grantedAt.source': 'signup',
          'consent.marketing.grantedAt.ip': ip,
          'consent.marketing.grantedAt.text': marketingText,
        };
      },

      // Fix 12: Reconcile consent.{legal,marketing}.grantedAt against metadata.created.
      // Existing granted consents were backfilled from whatever metadata.created was at
      // the time — now that Fix 8 pulls the canonical creation time from Firebase Auth,
      // any pre-existing grantedAt timestamps that don't match should be corrected.
      (data) => {
        const createdTimestamp = data.metadata?.created?.timestamp;
        const createdTimestampUNIX = data.metadata?.created?.timestampUNIX;
        if (!createdTimestamp || !createdTimestampUNIX) {
          return null;
        }

        const updates = {};
        for (const kind of ['legal', 'marketing']) {
          const grantedAt = data.consent?.[kind]?.grantedAt;
          if (!grantedAt) {
            continue;
          }
          if (grantedAt.timestampUNIX !== createdTimestampUNIX) {
            updates[`consent.${kind}.grantedAt.timestamp`] = createdTimestamp;
            updates[`consent.${kind}.grantedAt.timestampUNIX`] = createdTimestampUNIX;
          }
        }

        return Object.keys(updates).length > 0 ? updates : null;
      },

      // Fix 13: Fold the legacy attribution.utm blob → attribution.first/last.
      // Runs before the defaults backfill for the same reason Fix 11 does: once
      // the backfill has written the empty touches, the fold reads them as an
      // earlier migration's work and drops the blob it should have folded.
      createAttributionFoldFix(),

      // Fix 14: Backfill all missing fields with defaults
      (data) => {
        const merged = deepMergeDefaults(data, DEFAULT_USER);

        // Build flat update object for only the top-level keys that changed
        // Uses deepEqual to avoid false positives from key-order differences
        const updates = {};
        for (const key of Object.keys(DEFAULT_USER)) {
          if (!deepEqual(data[key], merged[key])) {
            updates[key] = merged[key];
          }
        }

        return Object.keys(updates).length > 0 ? updates : null;
      },

      // Fix 15: Generate dynamic values for empty fields
      // The @omega.js/backend user schema generates these at signup: affiliate.code, api.clientId, api.privateKey
      (data) => {
        const updates = {};
        let hasUpdates = false;

        if (!data.affiliate?.code) {
          updates['affiliate.code'] = generateId(7);
          hasUpdates = true;
        }

        if (!data.api?.clientId) {
          updates['api.clientId'] = randomUUID();
          hasUpdates = true;
        }

        if (!data.api?.privateKey) {
          updates['api.privateKey'] = randomBytes(32).toString('hex');
          hasUpdates = true;
        }

        return hasUpdates ? updates : null;
      },

      // Fix 16: Normalize empty strings and old sentinel values to null
      // Old defaults used '' for unknown strings and '127.0.0.1'/'ZZ'/'Unknown' for geolocation
      (data) => {

        const SENTINEL_VALUES = new Set(['', '127.0.0.1', 'ZZ', 'Unknown']);

        const updates = {};
        let hasUpdates = false;

        for (const path of SENTINEL_FIELDS) {
          const parts = path.split('.');
          let value = data;
          for (const part of parts) {
            value = value?.[part];
          }

          if (typeof value === 'string' && SENTINEL_VALUES.has(value)) {
            updates[path] = null;
            hasUpdates = true;
          }
        }

        return hasUpdates ? updates : null;
      },

      // Fix 17: Recursively trim whitespace from all string values
      createSanitizeFix(),

      // Fix 18: Reset null values to their correct defaults for non-nullable fields
      (data) => {
        const updates = {};
        let hasUpdates = false;

        for (const [path, defaultValue] of Object.entries(RESET_DEFAULTS)) {
          const parts = path.split('.');
          let value = data;
          for (const part of parts) {
            value = value?.[part];
          }

          if (value === null || (typeof defaultValue === 'number' && value === '')) {
            updates[path] = defaultValue;
            hasUpdates = true;
          }
        }

        return hasUpdates ? updates : null;
      },

      // Fix 19: Migrate usage.*.period → usage.*.monthly + add usage.*.daily
      // Sets the whole usage.{metric} object to avoid dot-notation conflicts with Fix 20
      (data) => {
        if (!data.usage || typeof data.usage !== 'object') {
          return null;
        }

        const updates = {};
        let hasUpdates = false;

        for (const [metric, values] of Object.entries(data.usage)) {
          if (!values || typeof values !== 'object') {
            continue;
          }

          const needsPeriodMigrate = values.period !== undefined;
          const needsDailyBackfill = values.daily === undefined;

          if (!needsPeriodMigrate && !needsDailyBackfill) {
            continue;
          }

          // Build the corrected object (removing period, adding monthly/daily)
          const corrected = { ...values };

          if (needsPeriodMigrate) {
            corrected.monthly = (corrected.monthly || 0) + (corrected.period || 0);
            delete corrected.period;
          }

          if (needsDailyBackfill) {
            corrected.daily = 0;
          }

          updates[`usage.${metric}`] = corrected;
          hasUpdates = true;
        }

        return hasUpdates ? updates : null;
      },

      // Fix 20: Delete any usage key where total == 0 (unused placeholder)
      // @omega.js/backend creates usage keys on first use — no need for zero-total placeholders.
      (data) => {
        if (!data.usage || typeof data.usage !== 'object') {
          return null;
        }

        const updates = {};
        let hasUpdates = false;

        for (const [key, values] of Object.entries(data.usage)) {
          if (!values || typeof values !== 'object') {
            continue;
          }

          if ((values.total || 0) === 0) {
            updates[`usage.${key}`] = FieldValue.delete();
            hasUpdates = true;
          }
        }

        return hasUpdates ? updates : null;
      },
    ],

    validate: (data) => {
      return validateDocument(data, USER_VALIDATION);
    },
  });
};
