/**
 * Users collection migration — converges user documents to the canonical
 * @omega.js/backend user schema.
 *
 * Fixes:
 * - Deletes orphaned user docs (no matching Firebase Auth user)
 * - Renames `plan` → `subscription`
 * - Transforms flat `subscription.id` (string) → `subscription.product` (object)
 * - Renames `subscription.trial.activated` → `subscription.trial.claimed`
 * - Removes deprecated payment/limits/trial/affiliate fields
 * - Migrates legacy timestamps → metadata.* and reconciles metadata.created
 *   against Firebase Auth's canonical creation time
 * - Backfills auth.uid/auth.email from Firebase Auth when missing
 * - Backfills consent (implicit grant at signup) for existing users
 * - Folds the legacy `attribution.utm` blob into `attribution.first`/`last`
 * - Backfills all missing fields with defaults from the @omega.js/backend user schema
 * - Generates dynamic values for affiliate.code, api.clientId, api.privateKey
 * - Normalizes '' and old sentinels ('127.0.0.1', 'ZZ', 'Unknown') to null
 * - Migrates usage.*.period → usage.*.monthly (+ daily backfill) and deletes
 *   zero-total usage placeholders
 *
 * De-ITW'd from omega-manager: the company instance's one-off damage-repair
 * fixes (per-brand usage-key renames, stray-key rescue from prior bad runs,
 * HTML-entity decoding from an old sanitize middleware, UID/base64 affiliate
 * code repair, the somiibo keep-plan carve-out) stay in omega-manager —
 * they repair one company's historical data, not the schema.
 *
 * Validates:
 * - All fields match the expected schema
 */
const { randomUUID, randomBytes } = require('node:crypto');

const { runMigration, FieldValue } = require('../lib/migration-runner.js');
const { createMetadataFix } = require('../lib/ensure-metadata.js');
const { validateDocument } = require('../lib/schema-validator.js');
const { createSanitizeFix } = require('../lib/sanitize-strings.js');
const { createAttributionFoldFix } = require('../lib/attribution-touch.js');

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
 * Default user structure from @omega.js/backend's user schema.
 * Values here are used to backfill missing fields during migration.
 *
 * Dynamic fields (affiliate.code, api.clientId, api.privateKey) use empty strings here
 * and are generated per-doc in the dynamic-values fix.
 */
const DEFAULT_USER = {
  auth: {
    uid: null,
    email: null,
    temporary: false,
  },
  subscription: {
    product: {
      id: 'basic',
      name: 'Basic',
    },
    status: 'active',
    expires: {
      timestamp: '1970-01-01T00:00:00.000Z',
      timestampUNIX: 0,
    },
    trial: {
      claimed: false,
      expires: {
        timestamp: '1970-01-01T00:00:00.000Z',
        timestampUNIX: 0,
      },
    },
    cancellation: {
      pending: false,
      date: {
        timestamp: '1970-01-01T00:00:00.000Z',
        timestampUNIX: 0,
      },
    },
    payment: {
      provider: null,
      orderId: null,
      resourceId: null,
      frequency: null,
      price: 0,
      startDate: {
        timestamp: '1970-01-01T00:00:00.000Z',
        timestampUNIX: 0,
      },
      updatedBy: {
        event: {
          name: null,
          id: null,
        },
        date: {
          timestamp: '1970-01-01T00:00:00.000Z',
          timestampUNIX: 0,
        },
      },
    },
  },
  roles: {
    admin: false,
    betaTester: false,
    developer: false,
  },
  flags: {
    signupProcessed: false,
  },
  affiliate: {
    code: '',
    referrals: [],
  },
  metadata: {
    created: {
      timestamp: '1970-01-01T00:00:00.000Z',
      timestampUNIX: 0,
    },
    updated: {
      timestamp: '1970-01-01T00:00:00.000Z',
      timestampUNIX: 0,
    },
  },
  activity: {
    geolocation: {
      ip: null,
      continent: null,
      country: null,
      region: null,
      city: null,
      latitude: 0,
      longitude: 0,
    },
    client: {
      language: null,
      mobile: false,
      device: null,
      platform: null,
      browser: null,
      vendor: null,
      runtime: null,
      userAgent: null,
      url: null,
    },
  },
  api: {
    clientId: '',
    privateKey: '',
  },
  usage: {},
  personal: {
    birthday: {
      timestamp: '1970-01-01T00:00:00.000Z',
      timestampUNIX: 0,
    },
    gender: null,
    location: {
      country: null,
      region: null,
      city: null,
    },
    name: {
      first: null,
      last: null,
    },
    company: {
      name: null,
      position: null,
    },
    telephone: {
      countryCode: 0,
      national: 0,
    },
  },
  oauth2: {},
  attribution: {
    affiliate: {
      code: null,
      timestamp: null,
      url: null,
      page: null,
    },
    // The #384 touch model. `tags`/`clickIds` are deliberately absent from the
    // default: a visit that carried none writes no key at all, so backfilling
    // them here would re-inject the empty husks the fold refuses to write.
    first: {
      referrer: null,
      url: null,
      page: null,
      timestamp: null,
    },
    last: {
      referrer: null,
      url: null,
      page: null,
      timestamp: null,
    },
  },
  consent: {
    legal: {
      status: 'revoked',
      grantedAt: { timestamp: null, timestampUNIX: null, source: null, ip: null, text: null },
    },
    marketing: {
      status: 'revoked',
      grantedAt: { timestamp: null, timestampUNIX: null, source: null, ip: null, text: null },
      revokedAt: { timestamp: null, timestampUNIX: null, source: null, ip: null, text: null },
    },
  },
};

/**
 * Users collection schema
 * Based on @omega.js/backend's user schema
 */
const timestampSchema = {
  type: 'object',
  required: true,
  properties: {
    timestamp: { type: 'string', required: true },
    timestampUNIX: { type: 'number', required: true },
  },
};

/**
 * One attribution touch — @omega.js/account's ATTRIBUTION_TOUCH, shared by
 * `attribution.first` and `attribution.last`.
 *
 * `tags` and `clickIds` are optional because capture writes a key only when the
 * visit carried one: an organic landing has neither, and demanding them here
 * would flag every untagged user for a husk nothing should be writing.
 */
const attributionTouchSchema = {
  type: 'object',
  required: true,
  properties: {
    tags: { type: 'object', required: false },
    clickIds: { type: 'object', required: false },
    referrer: { type: 'string', required: true, nullable: true },
    url: { type: 'string', required: true, nullable: true },
    page: { type: 'string', required: true, nullable: true },
    timestamp: { type: 'string', required: true, nullable: true },
  },
};

const schema = {
  auth: {
    type: 'object',
    required: true,
    properties: {
      uid: { type: 'string', required: true, nullable: true },
      email: { type: 'string', required: true, nullable: true },
      temporary: { type: 'boolean', required: true },
    },
  },
  subscription: {
    type: 'object',
    required: true,
    properties: {
      product: {
        type: 'object',
        required: true,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
        },
      },
      status: { type: 'string', required: true },
      expires: timestampSchema,
      trial: {
        type: 'object',
        required: true,
        properties: {
          claimed: { type: 'boolean', required: true },
          expires: timestampSchema,
        },
      },
      cancellation: {
        type: 'object',
        required: true,
        properties: {
          pending: { type: 'boolean', required: true },
          date: timestampSchema,
        },
      },
      payment: {
        type: 'object',
        required: true,
        properties: {
          provider: { type: 'string', required: true, nullable: true },
          orderId: { type: 'string', required: true, nullable: true },
          resourceId: { type: 'string', required: true, nullable: true },
          frequency: { type: 'string', required: true, nullable: true },
          price: { type: 'number', required: true },
          startDate: timestampSchema,
          updatedBy: {
            type: 'object',
            required: true,
            properties: {
              event: {
                type: 'object',
                required: true,
                properties: {
                  name: { type: 'string', required: true, nullable: true },
                  id: { type: 'string', required: true, nullable: true },
                },
              },
              date: timestampSchema,
            },
          },
        },
      },
    },
  },
  roles: {
    type: 'object',
    required: true,
    properties: {
      admin: { type: 'boolean', required: true },
      betaTester: { type: 'boolean', required: true },
      developer: { type: 'boolean', required: true },
    },
  },
  flags: {
    type: 'object',
    required: true,
    properties: {
      signupProcessed: { type: 'boolean', required: true },
    },
  },
  affiliate: {
    type: 'object',
    required: true,
    properties: {
      code: { type: 'string', required: true },
      referrals: { type: 'array', required: true },
    },
  },
  metadata: {
    type: 'object',
    required: true,
    properties: {
      created: timestampSchema,
      updated: timestampSchema,
    },
  },
  activity: {
    type: 'object',
    required: true,
    properties: {
      geolocation: {
        type: 'object',
        required: true,
        properties: {
          ip: { type: 'string', required: true, nullable: true },
          continent: { type: 'string', required: true, nullable: true },
          country: { type: 'string', required: true, nullable: true },
          region: { type: 'string', required: true, nullable: true },
          city: { type: 'string', required: true, nullable: true },
          latitude: { type: 'number', required: true },
          longitude: { type: 'number', required: true },
        },
      },
      client: {
        type: 'object',
        required: true,
        properties: {
          language: { type: 'string', required: true, nullable: true },
          mobile: { type: 'boolean', required: true },
          device: { type: 'string', required: true, nullable: true },
          platform: { type: 'string', required: true, nullable: true },
          browser: { type: 'string', required: true, nullable: true },
          vendor: { type: 'string', required: true, nullable: true },
          runtime: { type: 'string', required: true, nullable: true },
          userAgent: { type: 'string', required: true, nullable: true },
          url: { type: 'string', required: true, nullable: true },
        },
      },
    },
  },
  api: {
    type: 'object',
    required: true,
    properties: {
      clientId: { type: 'string', required: true },
      privateKey: { type: 'string', required: true },
    },
  },
  usage: {
    type: 'object',
    required: true,
  },
  personal: {
    type: 'object',
    required: true,
    properties: {
      birthday: timestampSchema,
      gender: { type: 'string', required: true, nullable: true },
      location: {
        type: 'object',
        required: true,
        properties: {
          country: { type: 'string', required: true, nullable: true },
          region: { type: 'string', required: true, nullable: true },
          city: { type: 'string', required: true, nullable: true },
        },
      },
      name: {
        type: 'object',
        required: true,
        properties: {
          first: { type: 'string', required: true, nullable: true },
          last: { type: 'string', required: true, nullable: true },
        },
      },
      company: {
        type: 'object',
        required: true,
        properties: {
          name: { type: 'string', required: true, nullable: true },
          position: { type: 'string', required: true, nullable: true },
        },
      },
      telephone: {
        type: 'object',
        required: true,
        properties: {
          countryCode: { type: 'number', required: true },
          national: { type: 'number', required: true },
        },
      },
    },
  },
  oauth2: { type: 'object', required: true },
  attribution: {
    type: 'object',
    required: true,
    properties: {
      affiliate: {
        type: 'object',
        required: true,
        properties: {
          code: { type: 'string', required: true, nullable: true },
          timestamp: { type: 'string', required: true, nullable: true },
          url: { type: 'string', required: true, nullable: true },
          page: { type: 'string', required: true, nullable: true },
        },
      },
      first: attributionTouchSchema,
      last: attributionTouchSchema,
    },
  },
  consent: {
    type: 'object',
    required: true,
    properties: {
      legal: {
        type: 'object',
        required: true,
        properties: {
          status: { type: 'string', required: true },
          grantedAt: {
            type: 'object',
            required: true,
            properties: {
              timestamp: { type: 'string', required: true, nullable: true },
              timestampUNIX: { type: 'number', required: true, nullable: true },
              source: { type: 'string', required: true, nullable: true },
              ip: { type: 'string', required: true, nullable: true },
              text: { type: 'string', required: true, nullable: true },
            },
          },
        },
      },
      marketing: {
        type: 'object',
        required: true,
        properties: {
          status: { type: 'string', required: true },
          grantedAt: {
            type: 'object',
            required: true,
            properties: {
              timestamp: { type: 'string', required: true, nullable: true },
              timestampUNIX: { type: 'number', required: true, nullable: true },
              source: { type: 'string', required: true, nullable: true },
              ip: { type: 'string', required: true, nullable: true },
              text: { type: 'string', required: true, nullable: true },
            },
          },
          revokedAt: {
            type: 'object',
            required: true,
            properties: {
              timestamp: { type: 'string', required: true, nullable: true },
              timestampUNIX: { type: 'number', required: true, nullable: true },
              source: { type: 'string', required: true, nullable: true },
              ip: { type: 'string', required: true, nullable: true },
              text: { type: 'string', required: true, nullable: true },
            },
          },
        },
      },
    },
  },
};

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

      // Fix 4: Remove deprecated fields
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

      // Fix 5: Fix affiliate.referrals from object to array,
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

      // Fix 6: Migrate legacy timestamps → metadata.created/updated
      // Falls back to the document's server createTime/updateTime if no legacy fields exist
      createMetadataFix({
        legacyCreatedFields: ['activity.created', 'created'],
        legacyUpdatedFields: ['activity.lastActivity', 'updated'],
      }),

      // Fix 7: Reconcile metadata.created against Firebase Auth's creationTime.
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

      // Fix 8: Backfill auth.uid and auth.email from Firebase Auth when missing.
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

      // Fix 9: Flatten personal.company from string to object
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

      // Fix 10: Backfill consent for existing users (implicit grant at signup).
      // Runs before the defaults backfill so derived values aren't overwritten
      // by DEFAULT_USER nulls. metadata.created is finalized by Fix 6/7;
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

      // Fix 11: Reconcile consent.{legal,marketing}.grantedAt against metadata.created.
      // Existing granted consents were backfilled from whatever metadata.created was at
      // the time — now that Fix 7 pulls the canonical creation time from Firebase Auth,
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

      // Fix 12: Fold the legacy attribution.utm blob → attribution.first/last.
      // Runs before the defaults backfill for the same reason Fix 10 does: once
      // the backfill has written the empty touches, the fold reads them as an
      // earlier migration's work and drops the blob it should have folded.
      createAttributionFoldFix(),

      // Fix 13: Backfill all missing fields with defaults
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

      // Fix 14: Generate dynamic values for empty fields
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

      // Fix 15: Normalize empty strings and old sentinel values to null
      // Old defaults used '' for unknown strings and '127.0.0.1'/'ZZ'/'Unknown' for geolocation
      (data) => {
        const NULLABLE_FIELDS = [
          'activity.geolocation.ip',
          'activity.geolocation.continent',
          'activity.geolocation.country',
          'activity.geolocation.region',
          'activity.geolocation.city',
          'activity.client.language',
          'activity.client.device',
          'activity.client.platform',
          'activity.client.browser',
          'activity.client.vendor',
          'activity.client.runtime',
          'activity.client.userAgent',
          'activity.client.url',
          'personal.gender',
          'personal.location.country',
          'personal.location.region',
          'personal.location.city',
          'personal.name.first',
          'personal.name.last',
          'personal.company.name',
          'personal.company.position',
        ];

        const SENTINEL_VALUES = new Set(['', '127.0.0.1', 'ZZ', 'Unknown']);

        const updates = {};
        let hasUpdates = false;

        for (const path of NULLABLE_FIELDS) {
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

      // Fix 16: Recursively trim whitespace from all string values
      createSanitizeFix(),

      // Fix 17: Reset null values to their correct defaults for non-nullable fields
      (data) => {
        const RESET_MAP = {
          // Timestamps should never be null — reset to epoch
          'personal.birthday.timestamp': '1970-01-01T00:00:00.000Z',
          'personal.birthday.timestampUNIX': 0,
          'metadata.created.timestamp': '1970-01-01T00:00:00.000Z',
          'metadata.created.timestampUNIX': 0,
          'metadata.updated.timestamp': '1970-01-01T00:00:00.000Z',
          'metadata.updated.timestampUNIX': 0,
          'subscription.expires.timestamp': '1970-01-01T00:00:00.000Z',
          'subscription.expires.timestampUNIX': 0,
          'subscription.trial.expires.timestamp': '1970-01-01T00:00:00.000Z',
          'subscription.trial.expires.timestampUNIX': 0,
          'subscription.cancellation.date.timestamp': '1970-01-01T00:00:00.000Z',
          'subscription.cancellation.date.timestampUNIX': 0,
          'subscription.payment.startDate.timestamp': '1970-01-01T00:00:00.000Z',
          'subscription.payment.startDate.timestampUNIX': 0,
          'subscription.payment.updatedBy.date.timestamp': '1970-01-01T00:00:00.000Z',
          'subscription.payment.updatedBy.date.timestampUNIX': 0,
          // Coordinates should never be null — reset to 0
          'activity.geolocation.latitude': 0,
          'activity.geolocation.longitude': 0,
          // Boolean fields should never be null — reset to false
          'activity.client.mobile': false,
          // Telephone fields should never be null — reset to 0
          'personal.telephone.countryCode': 0,
          'personal.telephone.national': 0,
        };

        const updates = {};
        let hasUpdates = false;

        for (const [path, defaultValue] of Object.entries(RESET_MAP)) {
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

      // Fix 18: Migrate usage.*.period → usage.*.monthly + add usage.*.daily
      // Sets the whole usage.{metric} object to avoid dot-notation conflicts with Fix 19
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

      // Fix 19: Delete any usage key where total == 0 (unused placeholder)
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
      return validateDocument(data, schema);
    },
  });
};

// Exported for tests — the canonical @omega.js/backend default user shape the backfill converges to
module.exports.DEFAULT_USER = DEFAULT_USER;
