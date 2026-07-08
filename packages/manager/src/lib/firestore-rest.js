/**
 * Firestore REST client authenticated with a Google service account —
 * the non-interactive replacement for omega-manager's firebase-admin
 * `getFirestore(brandId)` (which read `.output/{brandId}/secrets/`).
 *
 * Used by the services that write into an external product's Firestore
 * (slapform, and chatsy/replyify when they port): the operator provides a
 * service-account JSON for that product's Firebase project via an env var
 * holding a file path (absolute, or relative to the brand root — e.g.
 * `.omega/secrets/slapform-service-account.json`).
 *
 * Auth is a plain RS256 JWT-bearer grant (node:crypto — no SDK dependency).
 * Documents cross the API as plain JS objects; the Firestore typed-value
 * encoding is internal. Handlers call named methods (getDoc/patchDoc/setDoc)
 * so tests fake this surface method-for-method.
 */
const { isAbsolute, join } = require('node:path');
const fs = require('node:fs');

const { signJwt } = require('./jwt.js');

const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';

/**
 * Load and validate a service-account JSON from an env-provided path.
 *
 * @param {string} envValue - Path from the env var (absolute or brand-root-relative)
 * @param {string} brandRoot - Brand-monorepo root for resolving relative paths
 * @returns {Object} Parsed service-account credentials
 */
function loadServiceAccount(envValue, brandRoot) {
  const path = isAbsolute(envValue) ? envValue : join(brandRoot, envValue);

  if (!fs.existsSync(path)) {
    throw new Error(`Service-account file not found at ${path}`);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Service-account file at ${path} is not valid JSON: ${error.message}`);
  }

  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error(`Service-account file at ${path} is missing project_id/client_email/private_key`);
  }

  return serviceAccount;
}

/**
 * Encode a plain JS value as a Firestore typed value.
 */
function encodeValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    // REST integers are string-encoded (int64)
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new Error(`Cannot encode value of type ${typeof value} for Firestore`);
}

function encodeFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    fields[key] = encodeValue(value);
  }
  return fields;
}

/**
 * Decode a Firestore typed value back to plain JS.
 */
function decodeValue(typed) {
  if ('nullValue' in typed) return null;
  if ('booleanValue' in typed) return typed.booleanValue;
  if ('integerValue' in typed) return parseInt(typed.integerValue, 10);
  if ('doubleValue' in typed) return typed.doubleValue;
  if ('stringValue' in typed) return typed.stringValue;
  if ('timestampValue' in typed) return typed.timestampValue;
  if ('referenceValue' in typed) return typed.referenceValue;
  if ('arrayValue' in typed) return (typed.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in typed) return decodeFields(typed.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const obj = {};
  for (const [key, typed] of Object.entries(fields)) {
    obj[key] = decodeValue(typed);
  }
  return obj;
}

class FirestoreREST {
  constructor(serviceAccount) {
    this.serviceAccount = serviceAccount;
    this.projectId = serviceAccount.project_id;
    this.accessToken = null;
    this.tokenExpiry = 0;
  }

  /**
   * Exchange a signed RS256 JWT for an access token (cached until expiry).
   */
  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    const now = Math.floor(Date.now() / 1000);
    const assertion = signJwt(
      { alg: 'RS256', typ: 'JWT' },
      {
        iss: this.serviceAccount.client_email,
        scope: SCOPE,
        aud: GOOGLE_TOKEN_URL,
        iat: now,
        exp: now + 3600,
      },
      this.serviceAccount.private_key,
    );

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Service-account auth failed: ${data.error_description || data.error}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);

    return this.accessToken;
  }

  async request(method, docPath, { query, body } = {}) {
    const token = await this.getAccessToken();
    const url = new URL(`${FIRESTORE_API_BASE}/projects/${this.projectId}/databases/(default)/documents/${docPath}`);

    for (const [key, values] of Object.entries(query || {})) {
      for (const value of [].concat(values)) {
        url.searchParams.append(key, value);
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });

    if (response.status === 404) {
      return null;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Firestore API error: ${data.error?.message || JSON.stringify(data)}`);
    }

    return data;
  }

  /**
   * Read a document as a plain JS object. Missing document → null.
   *
   * @param {string} docPath - e.g. 'forms/abc123'
   */
  async getDoc(docPath) {
    const doc = await this.request('GET', docPath);
    return doc ? decodeFields(doc.fields || {}) : null;
  }

  /**
   * Merge-write specific fields of a document (created if missing) — the
   * REST equivalent of the admin SDK's `set(data, { merge: true })`:
   * updateMask carries the LEAF field paths so sibling fields the caller
   * doesn't mention survive untouched.
   *
   * @param {string} docPath - e.g. 'users/uid123'
   * @param {Object} data - Plain nested object with the desired values
   * @param {string[]} fieldPaths - Dotted leaf paths to write (the updateMask)
   */
  async patchDoc(docPath, data, fieldPaths) {
    return this.request('PATCH', docPath, {
      query: { 'updateMask.fieldPaths': fieldPaths },
      body: { fields: encodeFields(data) },
    });
  }

  /**
   * Replace-write a whole document (created if missing) — the REST
   * equivalent of the admin SDK's `set(data, { merge: false })`: no
   * updateMask, so fields absent from `data` are removed from the document.
   *
   * @param {string} docPath - e.g. 'brands/my-brand'
   * @param {Object} data - Plain nested object; becomes the ENTIRE document
   */
  async setDoc(docPath, data) {
    return this.request('PATCH', docPath, {
      body: { fields: encodeFields(data) },
    });
  }
}

module.exports = { FirestoreREST, loadServiceAccount, encodeFields, decodeFields };
