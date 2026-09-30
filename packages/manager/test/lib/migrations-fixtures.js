/**
 * Shared fixtures for the migrations service tests: method-level recording fakes
 * of the FirestoreREST client and the auth admin, a service runner, and a users
 * doc already converged to the account schema.
 */
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { OPERATIONS } = require('../../src/config.js');
const { DEFAULT_USER } = require('../../src/services/migrations/lib/user-schema.js');
const service = require('../../src/services/migrations/index.js');

const CREATION_TIME = '2024-03-01T00:00:00.000Z';
const USER_RECORD = {
  uid: 'uid-1',
  email: 'user@fixture-brand.test',
  providerData: [],
  metadata: { creationTime: CREATION_TIME },
};

/** { timestamp, timestampUNIX } from an ISO string. */
const tsObj = (iso) => ({
  timestamp: new Date(iso).toISOString(),
  timestampUNIX: Math.round(Date.parse(iso) / 1000),
});

function stageBrand() {
  return mkdtempSync(join(tmpdir(), 'omega-migrations-'));
}

function brandConfig(overrides = {}) {
  return {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
    targets: { web: { type: 'web' }, backend: { type: 'backend' } },
    cloud: { shared: false },
    ...overrides,
  };
}

/** Method-level recording fake: a call with no configured response throws LOUDLY. */
function makeFake(name, methods, mutating, responses) {
  const api = { calls: [] };

  for (const method of methods) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`${name}: unexpected call ${method}(${JSON.stringify(args[0])})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  api.mutations = () => api.calls.filter((c) => mutating.has(c.method));
  api.of = (method) => api.calls.filter((c) => c.method === method);
  return api;
}

function fakeAuth(responses = {}) {
  return makeFake('fakeAuth', ['getUser'], new Set(), responses);
}

function fakeFirestore(responses = {}) {
  const api = makeFake('fakeFirestore',
    ['countDocs', 'listDocs', 'getDocWithMeta', 'getDoc', 'patchDoc', 'deleteDoc'],
    new Set(['patchDoc', 'deleteDoc']), responses);
  api.projectId = 'fixture-project';
  return api;
}

/** A single-page collection: countDocs + one listDocs page holding `docs`. */
function collectionOf(docs, extraResponses = {}) {
  return fakeFirestore({
    countDocs: docs.length,
    listDocs: { docs, nextPageToken: null },
    patchDoc: {},
    deleteDoc: {},
    ...extraResponses,
  });
}

async function runService(config, { root, auth, firestore, options } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: root || stageBrand(),
    brandConfig: config,
    operations: OPERATIONS.migrations,
    options: options !== undefined ? options : { migration: true },
    serviceData: {},
    authAdmin: auth,
    firestore,
  });
}

/** A users doc already converged to the @omega.js/account schema (auth creation time reconciled). */
function convergedUser(id = 'uid-1') {
  const data = structuredClone(DEFAULT_USER);
  data.auth = { uid: id, email: USER_RECORD.email, temporary: false };
  data.affiliate.code = 'abc1234';
  data.api = { clientId: 'client-1', privateKey: 'f'.repeat(64) };
  data.metadata = { created: tsObj(CREATION_TIME), updated: tsObj('2024-04-01T00:00:00.000Z') };
  const grantedAt = (text) => ({ ...tsObj(CREATION_TIME), source: 'signup', ip: null, text });
  data.consent = {
    legal: { status: 'granted', grantedAt: grantedAt('I agree to the terms.') },
    marketing: {
      status: 'granted',
      grantedAt: grantedAt('I agree to marketing.'),
      revokedAt: { timestamp: null, timestampUNIX: null, source: null, ip: null, text: null },
    },
  };
  return { id, createTime: '2024-03-01T00:00:00.000000Z', updateTime: '2024-04-01T00:00:00.000000Z', data };
}

module.exports = {
  CREATION_TIME, USER_RECORD, tsObj, stageBrand, brandConfig,
  fakeAuth, fakeFirestore, collectionOf, runService, convergedUser,
};
