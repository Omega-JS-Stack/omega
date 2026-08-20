/**
 * core — the ONE place GA4 Measurement Protocol semantics live
 * (C4 cp106b; Ian: "unify it and have it in one place").
 *
 * Pure functions, zero runtime assumptions: no DOM, no storage, no
 * transport. @omega.js/client's browser engine and @omega.js/desktop's
 * main-process lib both consume THIS module, so identity math and payload
 * shape can never drift between surfaces again. It moved here from the client
 * ([#382](https://github.com/Omega-JS-Stack/omega/issues/382)) so the server
 * side reaches it without importing the frontend runtime.
 *
 * Cross-surface identity:
 *   namespace = uuidv5(projectId, uuidv5.URL)
 *   client_id = uuidv5(deviceId, namespace)   — same device, same GA client
 *   user_id   = uuidv5(firebaseUid, namespace) — same human, every surface
 * Raw uids/device ids never leave the machine; without a namespace the
 * user_id stays null (never the raw value).
 *
 * CJS on purpose: desktop's Electron main process require()s it directly
 * (via the package's dist exports); the ESM browser module imports it with
 * standard interop.
 */

const { v5: uuidv5 } = require('uuid');

const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/** uuidv5 namespace for a project — null in, null out. */
function deriveNamespace(projectId) {
  return projectId ? uuidv5(String(projectId), uuidv5.URL) : null;
}

/** Stable GA client_id: hashed into the namespace when one exists. */
function deriveClientId(deviceId, namespace) {
  return namespace ? uuidv5(String(deviceId), namespace) : deviceId;
}

/** GA user_id from a raw uid — no namespace → null (raw uids never ship). */
function deriveUserId(uid, namespace) {
  return (uid && namespace) ? uuidv5(String(uid), namespace) : null;
}

/** GA4 event names: letters/digits/underscore, ≤40 chars, no edge underscores. */
function normalizeEventName(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }

  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 40);
}

/** GA4 user_properties wrapping: { plan: 'pro' } → { plan: { value: 'pro' } }. */
function wrapUserProperties(properties = {}) {
  const wrapped = {};
  for (const [key, value] of Object.entries(properties)) {
    wrapped[key] = { value };
  }
  return wrapped;
}

/** Measurement Protocol collect URL. */
function buildCollectUrl(measurementId, secret) {
  return `${GA_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(secret)}`;
}

/**
 * Measurement Protocol payload. userId/userProperties are omitted when
 * empty — GA rejects nulls, and an empty user_properties block is noise.
 */
function buildPayload({ clientId, userId = null, userProperties = {}, eventName, params = {} }) {
  return {
    client_id: clientId,
    ...(userId ? { user_id: userId } : {}),
    ...(Object.keys(userProperties).length ? { user_properties: userProperties } : {}),
    events: [{
      name: eventName,
      params,
    }],
  };
}

module.exports = {
  GA_ENDPOINT,
  deriveNamespace,
  deriveClientId,
  deriveUserId,
  normalizeEventName,
  wrapUserProperties,
  buildCollectUrl,
  buildPayload,
};
