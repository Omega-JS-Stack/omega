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
 *   deviceId  = the host's stored id, its seed strategy, or a fresh uuidv4
 *   client_id = uuidv5(deviceId, namespace)   — same device+surface, same GA client
 *   namespace = uuidv5(projectId, uuidv5.URL)
 *   user_id   = uuidv5(firebaseUid, namespace) — same human, every surface
 * Raw uids/device ids never leave the machine; without a namespace the
 * user_id stays null (never the raw value).
 *
 * `deriveDeviceId` is where the chain starts and the only step that touches a
 * host's world — so its persistence and its seed strategy are INJECTED
 * ([#396](https://github.com/Omega-JS-Stack/omega/issues/396)), which keeps this
 * module as assumption-free as the rest of it.
 *
 * CJS on purpose: desktop's Electron main process require()s it directly
 * (via the package's dist exports); the ESM browser module imports it with
 * standard interop.
 */

const { v4: uuidv4, v5: uuidv5 } = require('uuid');

const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/**
 * The stable per-install device id every surface's client_id is hashed from —
 * ONE derivation, on the `createRequest(deps)` mold: what differs per target is
 * WHERE it persists and WHAT it seeds from, and both are handed in.
 *
 * The walk is stored → seed → uuidv4. Storage wins so an id survives whatever
 * the seed does next (desktop stays put across a NIC swap or a VPN); the seed is
 * what gives a wiped install continuity (desktop's first non-internal MAC), and
 * a host with none — a browser, where nothing about the machine is readable —
 * generates one and persists it. The floor is the `uuid` package's `v4`, which
 * yields a REAL uuid in every runtime this ships to: it uses the platform's
 * `crypto.randomUUID` where that exists and `getRandomValues` where it does not
 * (an insecure origin), so no surface ever falls back to a random-looking string.
 *
 * @param {object} deps - The host's world.
 * @param {function(): string|null} deps.get - Read the persisted id.
 * @param {function(string): void} deps.set - Persist a freshly derived id.
 * @param {function(): string|null} [deps.seed] - The target's id source, asked
 *   only when nothing is stored. Anything falsy falls through to the uuid.
 * @returns {string} The raw device id — never sent anywhere as-is.
 */
function deriveDeviceId(deps) {
  if (typeof deps?.get !== 'function' || typeof deps?.set !== 'function') {
    throw new Error('deriveDeviceId requires get and set deps');
  }

  const stored = deps.get();

  if (stored) {
    return stored;
  }

  const deviceId = (deps.seed ? deps.seed() : null) || uuidv4();

  deps.set(deviceId);

  return deviceId;
}

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
  deriveDeviceId,
  deriveNamespace,
  deriveClientId,
  deriveUserId,
  normalizeEventName,
  wrapUserProperties,
  buildCollectUrl,
  buildPayload,
};
