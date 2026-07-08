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

const { createTokenProvider } = require('./google-token.js');

const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1';
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
    this.tokenProvider = createTokenProvider(serviceAccount, SCOPE);
  }

  /**
   * Access token for the datastore scope (cached by the shared provider).
   */
  getAccessToken() {
    return this.tokenProvider.getAccessToken();
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
   * POST to a colon method on the documents root (documents:runQuery,
   * documents:runAggregationQuery) — those can't go through request()'s
   * docPath URL builder.
   */
  async rootRequest(method, body) {
    const token = await this.getAccessToken();
    const url = `${FIRESTORE_API_BASE}/projects/${this.projectId}/databases/(default)/documents:${method}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

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
   * Read a document with its server metadata — the REST stand-in for the
   * admin SDK's DocumentSnapshot (create/update times are ISO strings).
   * Missing document → null.
   *
   * @param {string} docPath - e.g. 'users/uid123'
   * @returns {Promise<{ id, createTime, updateTime, data }|null>}
   */
  async getDocWithMeta(docPath) {
    const doc = await this.request('GET', docPath);
    if (!doc) {
      return null;
    }
    return {
      id: doc.name.split('/').pop(),
      createTime: doc.createTime,
      updateTime: doc.updateTime,
      data: decodeFields(doc.fields || {}),
    };
  }

  /**
   * List one page of a collection's documents (ordered by name — Firestore's
   * listDocuments default), with server metadata like getDocWithMeta.
   *
   * @param {string} collectionPath - e.g. 'users'
   * @param {Object} [options]
   * @param {number} [options.pageSize=500]
   * @param {string} [options.pageToken] - From the previous page's nextPageToken
   * @returns {Promise<{ docs: Array<{ id, createTime, updateTime, data }>, nextPageToken: string|null }>}
   */
  async listDocs(collectionPath, { pageSize = 500, pageToken } = {}) {
    const query = { pageSize };
    if (pageToken) {
      query.pageToken = pageToken;
    }

    const data = (await this.request('GET', collectionPath, { query })) || {};

    return {
      docs: (data.documents || []).map((doc) => ({
        id: doc.name.split('/').pop(),
        createTime: doc.createTime,
        updateTime: doc.updateTime,
        data: decodeFields(doc.fields || {}),
      })),
      nextPageToken: data.nextPageToken || null,
    };
  }

  /**
   * Count a collection's documents server-side (aggregation query — no
   * document reads billed beyond the aggregation).
   *
   * @param {string} collectionId - Top-level collection id, e.g. 'users'
   * @returns {Promise<number>}
   */
  async countDocs(collectionId) {
    const data = await this.rootRequest('runAggregationQuery', {
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId }] },
        aggregations: [{ alias: 'count', count: {} }],
      },
    });

    const entry = (data || []).find((e) => e.result);
    return entry ? parseInt(entry.result.aggregateFields.count.integerValue, 10) : 0;
  }

  /**
   * Delete a document. Deleting a missing document is a no-op (Firestore
   * returns success either way).
   *
   * @param {string} docPath - e.g. 'users/uid123'
   */
  async deleteDoc(docPath) {
    return this.request('DELETE', docPath);
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

  /**
   * Run a structured query and return matching documents as plain objects.
   *
   * @param {Object} structuredQuery - Firestore StructuredQuery, e.g.
   *   { from: [{ collectionId: 'users' }], where: { fieldFilter: ... } }
   * @returns {Promise<Array<{ id: string, data: Object }>>}
   */
  async runQuery(structuredQuery) {
    const data = await this.rootRequest('runQuery', { structuredQuery });

    // Streamed response: one entry per result, some carry only readTime
    return data
      .filter((entry) => entry.document)
      .map((entry) => ({
        id: entry.document.name.split('/').pop(),
        data: decodeFields(entry.document.fields || {}),
      }));
  }
}

module.exports = { FirestoreREST, loadServiceAccount, encodeFields, decodeFields };
