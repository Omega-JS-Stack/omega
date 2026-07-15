/**
 * Migrations service tests — the notifications + users migrations against a
 * method-level recording fake of the FirestoreREST client (and the auth
 * admin for orphan detection), with the fix pipeline, conflict resolution,
 * and REST patch construction real. Proves the --migration gating (flag,
 * name filter, shared-project and service-account skips), pinned patch
 * payloads for the legacy transforms, orphan deletion, the converged
 * zero-mutation no-op, the warned status on write failures and
 * schema-invalid docs, --ids / --limit / pagination behavior, before/after
 * snapshots under .omega/migrations/, and the dry-run zero-mutation
 * guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { SERVICE_ORDER, OPERATIONS } = require('../src/config.js');
const { FieldValue } = require('../src/services/migrations/lib/migration-runner.js');
const { validateDocument } = require('../src/services/migrations/lib/schema-validator.js');
const { createSanitizeFix } = require('../src/services/migrations/lib/sanitize-strings.js');
const { createMetadataFix } = require('../src/services/migrations/lib/ensure-metadata.js');
const { DEFAULT_USER } = require('../src/services/migrations/ensure/users.js');
const service = require('../src/services/migrations/index.js');

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

function stageBrand() {
  return mkdtempSync(join(tmpdir(), 'omega-migrations-'));
}

function brandConfig(overrides = {}) {
  return {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
    targets: { web: {}, backend: {} },
    firebase: { shared: false },
    ...overrides,
  };
}

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
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
    brandState: {},
    operations: OPERATIONS.migrations,
    options: options !== undefined ? options : { migration: true },
    serviceData: {},
    authAdmin: auth,
    firestore,
  });
}

/** A notifications doc already in the canonical shape (client keys in DEFAULT order). */
function convergedNotification(id = 'notif-1') {
  return {
    id,
    createTime: '2023-05-01T00:00:00.000000Z',
    updateTime: '2023-06-01T00:00:00.000000Z',
    data: {
      token: 'tok-1',
      owner: 'uid-1',
      tags: ['news'],
      attribution: {},
      metadata: { created: tsObj('2023-05-01T00:00:00.000Z'), updated: tsObj('2023-06-01T00:00:00.000Z') },
      context: {
        client: {
          language: 'en', mobile: false, device: null, platform: 'MacIntel', browser: null,
          vendor: null, runtime: null, userAgent: 'UA', url: 'https://fixture-brand.test/',
        },
      },
    },
  };
}

/** A users doc already converged to the @omega.js/backend schema (auth creation time reconciled). */
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

// ─── Registry / sentinel / lib units ─────────────────────────────────────────

test('migrations: registered after account, before bookmark, with notifications then users', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('account') + 1], 'migrations');
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('migrations') + 1], 'bookmark');
  assert.deepEqual(OPERATIONS.migrations.map((o) => o.name), ['notifications', 'users']);
});

test('migrations: FieldValue.delete() is a stable identity sentinel', () => {
  assert.equal(FieldValue.delete(), FieldValue.delete());
});

test('schema-validator: type, required, nullable, and array item checks with dotted paths', () => {
  const schema = {
    token: { type: 'string', required: true },
    owner: { type: 'string', required: true, nullable: true },
    tags: { type: 'array', required: true, itemType: 'string' },
    metadata: {
      type: 'object',
      required: true,
      properties: { created: { type: 'object', required: true } },
    },
  };

  assert.deepEqual(
    validateDocument({ token: 't', owner: null, tags: ['a'], metadata: { created: {} } }, schema),
    { valid: true, errors: [] },
  );

  const result = validateDocument({ token: null, tags: ['a', 7], metadata: {} }, schema);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((e) => [e.field, e.message]), [
    ['token', 'Expected string, got null (field is not nullable)'],
    ['owner', 'Missing required field'],
    ['tags[1]', 'Array item expected string, got number'],
    ['metadata.created', 'Missing required field'],
  ]);
});

test('sanitize fix: trims nested strings and array items, no-ops on clean docs', () => {
  const fix = createSanitizeFix();

  assert.equal(fix({ name: 'clean', nested: { ok: 'yes' }, tags: ['a'] }), null);

  const updates = fix({ name: '  padded  ', nested: { ok: 'yes', bad: 'x ' }, tags: [' t1', 't2'] });
  const logs = updates.__logs__;
  delete updates.__logs__;
  assert.deepEqual(updates, { name: 'padded', 'nested.bad': 'x', tags: ['t1', 't2'] });
  assert.equal(logs.length, 3);
});

test('metadata fix: moves legacy fields, falls back to server times, no-ops when converged', () => {
  const fix = createMetadataFix({ legacyCreatedFields: ['created'], legacyUpdatedFields: ['updated'] });
  const doc = { id: 'd1', createTime: '2023-01-15T12:00:00.500000Z', updateTime: '2023-02-01T00:00:00.000000Z' };

  // Legacy fields move into metadata.* and are deleted
  const created = tsObj('2022-01-01T00:00:00.000Z');
  const updated = tsObj('2022-06-01T00:00:00.000Z');
  assert.deepEqual(fix({ created, updated }, doc), {
    'metadata.created': created,
    created: FieldValue.delete(),
    'metadata.updated': updated,
    updated: FieldValue.delete(),
  });

  // No legacy, no metadata → server timestamps (ISO strings, rounded UNIX)
  assert.deepEqual(fix({}, doc), {
    'metadata.created': { timestamp: '2023-01-15T12:00:00.500Z', timestampUNIX: 1673784001 },
    'metadata.updated': { timestamp: '2023-02-01T00:00:00.000Z', timestampUNIX: 1675209600 },
  });

  // Already converged → no-op
  assert.equal(fix({ metadata: { created, updated } }, doc), null);
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('migrations: no --migration flag skips the service', async () => {
  const result = await runService(brandConfig(), { options: {} });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /--migration flag not set/);
});

test('migrations: no backend target skips the service', async () => {
  const config = brandConfig();
  delete config.targets.backend;
  const result = await runService(config);
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no backend target/);
});

test('migrations: shared Firebase project skips the service', async () => {
  const result = await runService(brandConfig({ firebase: { shared: true } }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /shared Firebase project/);
});

test('migrations: unknown --migration name skips with the available list', async () => {
  const result = await runService(brandConfig(), { options: { migration: 'nope' } });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /migration "nope" not found/);
});

test('migrations: missing service account skips with firebase-service guidance', async () => {
  const result = await runService(brandConfig());
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /\.omega\/secrets\/service-account\.json.*cloud service/);
});

test('migrations: --migration=<name> runs only that migration', async () => {
  const firestore = collectionOf([]);
  const auth = fakeAuth({});

  const result = await runService(brandConfig(), {
    auth, firestore, options: { migration: 'notifications' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('countDocs').map((c) => c.args), [['notifications']]);
  assert.deepEqual(auth.calls, []);
});

// ─── Notifications migration ─────────────────────────────────────────────────

test('notifications: legacy doc converges in one pinned REST patch', async () => {
  const created = tsObj('2023-05-01T00:00:00.000Z');
  const updated = tsObj('2023-06-01T00:00:00.000Z');
  const doc = {
    id: 'notif-1',
    createTime: '2023-05-01T00:00:00.000000Z',
    updateTime: '2023-06-01T00:00:00.000000Z',
    data: {
      token: 'tok-1',
      uid: 'uid-1',
      tags: ['news'],
      created,
      updated,
      url: 'https://fixture-brand.test/page',
    },
  };
  const firestore = collectionOf([doc]);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({}), firestore, options: { migration: 'notifications' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('patchDoc').map((c) => c.args), [[
    'notifications/notif-1',
    {
      owner: 'uid-1',
      metadata: { created, updated },
      context: {
        client: {
          language: null, mobile: null, device: null, platform: null, browser: null,
          vendor: null, runtime: null, userAgent: null, url: 'https://fixture-brand.test/page',
        },
      },
      attribution: {},
    },
    ['uid', 'owner', 'metadata.created', 'created', 'metadata.updated', 'updated', 'context', 'url', 'attribution'],
  ]]);
  assert.deepEqual(result.output.notifications, {
    totalDocs: 1,
    validDocs: 1,
    invalidDocs: 0,
    docsFixed: 1,
    docsDeleted: undefined,
    errors: undefined,
    errorDocIds: undefined,
    invalidDocIds: undefined,
  });
});

test('notifications: converged doc is a zero-mutation no-op', async () => {
  const firestore = collectionOf([convergedNotification()]);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({}), firestore, options: { migration: 'notifications' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.mutations(), []);
  assert.equal(result.output.notifications.docsFixed, 0);
  assert.equal(result.output.notifications.validDocs, 1);
});

test('notifications: schema-invalid doc downgrades the service to warned', async () => {
  const doc = convergedNotification('notif-bad');
  delete doc.data.token;
  const firestore = collectionOf([doc]);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({}), firestore, options: { migration: 'notifications' },
  });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.notifications.invalidDocs, 1);
  assert.deepEqual(result.output.notifications.invalidDocIds, ['notif-bad']);
});

test('notifications: a failed write is counted and downgrades to warned', async () => {
  const doc = convergedNotification('notif-1');
  doc.data.uid = 'uid-legacy';
  delete doc.data.owner;
  const firestore = collectionOf([doc], {
    patchDoc: () => { throw new Error('firestore unavailable'); },
  });

  const result = await runService(brandConfig(), {
    auth: fakeAuth({}), firestore, options: { migration: 'notifications' },
  });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.notifications.errors, 1);
  assert.deepEqual(result.output.notifications.errorDocIds, [
    { id: 'notif-1', errors: ['Write failed: firestore unavailable'] },
  ]);
});

test('notifications: dry run counts the fix, writes the snapshot, and never mutates', async () => {
  const root = stageBrand();
  const doc = convergedNotification('notif-1');
  doc.data.uid = 'uid-legacy';
  delete doc.data.owner;
  const firestore = collectionOf([doc]);

  const result = await runService(brandConfig(), {
    root, auth: fakeAuth({}), firestore, options: { migration: 'notifications', dryRun: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.mutations(), []);
  assert.equal(result.output.notifications.docsFixed, 1);

  const snapshots = jetpack.find(join(root, '.omega', 'migrations', 'notifications'), { matching: '*.json' });
  const docSnapshot = snapshots.find((p) => p.endsWith('notif-1.json'));
  const summary = snapshots.find((p) => p.endsWith('_summary.json'));
  assert.ok(docSnapshot && summary);
  const { before, after, fixed } = jetpack.read(docSnapshot, 'json');
  assert.equal(before.uid, 'uid-legacy');
  assert.equal(after.owner, 'uid-legacy');
  assert.equal(fixed, true);
  assert.equal(jetpack.read(summary, 'json').dryRun, true);
});

// ─── Users migration ─────────────────────────────────────────────────────────

test('users: orphaned doc (no auth record) is deleted with a snapshot', async () => {
  const root = stageBrand();
  const doc = { id: 'uid-ghost', createTime: '2024-01-01T00:00:00Z', updateTime: '2024-01-01T00:00:00Z', data: { auth: { uid: 'uid-ghost' } } };
  const firestore = collectionOf([doc]);

  const result = await runService(brandConfig(), {
    root, auth: fakeAuth({ getUser: null }), firestore, options: { migration: 'users' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('deleteDoc').map((c) => c.args), [['users/uid-ghost']]);
  assert.deepEqual(firestore.of('patchDoc'), []);
  assert.equal(result.output.users.docsDeleted, 1);

  const snapshot = jetpack.find(join(root, '.omega', 'migrations', 'users'), { matching: 'uid-ghost.json' })[0];
  assert.deepEqual(jetpack.read(snapshot, 'json'), {
    before: { auth: { uid: 'uid-ghost' } },
    after: null,
    deleted: true,
  });
});

test('users: converged doc is a zero-mutation no-op that validates', async () => {
  const firestore = collectionOf([convergedUser()]);
  const auth = fakeAuth({ getUser: USER_RECORD });

  const result = await runService(brandConfig(), {
    auth, firestore, options: { migration: 'users' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.mutations(), []);
  assert.deepEqual(auth.of('getUser').map((c) => c.args), [['uid-1']]);
  assert.deepEqual(result.output.users, {
    totalDocs: 1,
    validDocs: 1,
    invalidDocs: 0,
    docsFixed: 0,
    docsDeleted: undefined,
    errors: undefined,
    errorDocIds: undefined,
    invalidDocIds: undefined,
  });
});

test('users: legacy plan field is deleted in a pinned patch (subscription wins)', async () => {
  const doc = convergedUser();
  doc.data.plan = { id: 'legacy' };
  const firestore = collectionOf([doc]);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('patchDoc').map((c) => c.args), [['users/uid-1', {}, ['plan']]]);
});

test('users: flat subscription.id/name become subscription.product in a pinned patch', async () => {
  const doc = convergedUser();
  delete doc.data.subscription.product;
  doc.data.subscription.id = 'premium';
  doc.data.subscription.name = 'Premium';
  const firestore = collectionOf([doc]);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('patchDoc').map((c) => c.args), [[
    'users/uid-1',
    { subscription: { product: { id: 'premium', name: 'Premium' } } },
    ['subscription.product', 'subscription.id', 'subscription.name'],
  ]]);
  assert.equal(result.output.users.validDocs, 1);
});

test('users: sparse doc gets the full @omega.js/backend backfill with auth-reconciled metadata and consent', async () => {
  const doc = { id: 'uid-1', createTime: '2023-01-15T12:00:00.000000Z', updateTime: '2023-02-01T00:00:00.000000Z', data: {} };
  const firestore = collectionOf([doc]);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users' },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.output.users.docsFixed, 1);
  assert.equal(result.output.users.validDocs, 1);

  const [docPath, sets, fieldPaths] = firestore.of('patchDoc')[0].args;
  assert.equal(docPath, 'users/uid-1');

  // Dotted descendants were absorbed into their top-level ancestors
  assert.deepEqual([...fieldPaths].sort(), [
    'activity', 'affiliate', 'api', 'attribution', 'auth', 'consent', 'flags',
    'metadata.created', 'metadata.updated', 'oauth2', 'personal', 'roles',
    'subscription', 'usage',
  ]);

  // Firebase Auth is canonical for identity and creation time
  assert.deepEqual(sets.auth, { uid: 'uid-1', email: USER_RECORD.email, temporary: false });
  assert.deepEqual(sets.metadata.created, tsObj(CREATION_TIME));
  assert.deepEqual(sets.metadata.updated, tsObj('2023-02-01T00:00:00.000Z'));

  // Consent backfilled as an implicit signup grant at the reconciled creation time
  assert.equal(sets.consent.legal.status, 'granted');
  assert.equal(sets.consent.legal.grantedAt.timestampUNIX, tsObj(CREATION_TIME).timestampUNIX);
  assert.match(sets.consent.legal.grantedAt.text, /Fixture Brand's Terms of Service/);
  assert.equal(sets.consent.marketing.status, 'granted');

  // Dynamic values generated per-doc
  assert.match(sets.affiliate.code, /^[0-9a-zA-Z]{7}$/);
  assert.match(sets.api.clientId, /^[0-9a-f-]{36}$/);
  assert.match(sets.api.privateKey, /^[0-9a-f]{64}$/);

  assert.deepEqual(sets.subscription, DEFAULT_USER.subscription);
  assert.deepEqual(sets.usage, {});
});

test('users: usage period → monthly migration and zero-total cleanup in one pinned patch', async () => {
  const doc = convergedUser();
  doc.data.usage = {
    requests: { total: 5, period: 3, monthly: 1 },
    old: { total: 0, monthly: 0, daily: 0 },
  };
  const firestore = collectionOf([doc]);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('patchDoc').map((c) => c.args), [[
    'users/uid-1',
    { usage: { requests: { total: 5, monthly: 4, daily: 0 } } },
    ['usage.requests', 'usage.old'],
  ]]);
});

test('users: affiliate.referrer resolves to the referrer\'s code via DB lookup', async () => {
  const doc = convergedUser();
  doc.data.affiliate.referrer = 'uid-referrer';
  const firestore = collectionOf([doc], {
    getDoc: { affiliate: { code: 'REF4567' } },
  });

  const result = await runService(brandConfig(), {
    auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: 'users' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('getDoc').map((c) => c.args), [['users/uid-referrer']]);
  assert.deepEqual(firestore.of('patchDoc').map((c) => c.args), [[
    'users/uid-1',
    { attribution: { affiliate: { code: 'REF4567' } } },
    ['attribution.affiliate.code', 'affiliate.referrer'],
  ]]);
});

test('users: dry run plans the backfill and the orphan delete without mutating', async () => {
  const sparse = { id: 'uid-1', createTime: '2023-01-15T12:00:00Z', updateTime: '2023-02-01T00:00:00Z', data: {} };
  const ghost = { id: 'uid-ghost', createTime: '2024-01-01T00:00:00Z', updateTime: '2024-01-01T00:00:00Z', data: {} };
  const firestore = collectionOf([sparse, ghost]);
  const auth = fakeAuth({ getUser: (uid) => (uid === 'uid-1' ? structuredClone(USER_RECORD) : null) });

  const result = await runService(brandConfig(), {
    auth, firestore, options: { migration: 'users', dryRun: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.mutations(), []);
  assert.equal(result.output.users.docsFixed, 1);
  assert.equal(result.output.users.docsDeleted, 1);
});

// ─── Runner mechanics: --migration (all), --ids, --limit, pagination ─────────

test('migrations: bare --migration runs every registered migration in order', async () => {
  const firestore = fakeFirestore({
    countDocs: 1,
    listDocs: (collection) => ({
      docs: [collection === 'notifications' ? convergedNotification() : convergedUser()],
      nextPageToken: null,
    }),
  });

  const result = await runService(brandConfig(), {
    auth: fakeAuth({ getUser: USER_RECORD }), firestore, options: { migration: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('countDocs').map((c) => c.args), [['notifications'], ['users']]);
  assert.deepEqual(firestore.mutations(), []);
  assert.deepEqual(Object.keys(result.output), ['notifications', 'users']);
});

test('migrations: --ids fetches exactly those docs and warns on missing ones', async () => {
  const firestore = fakeFirestore({
    getDocWithMeta: (path) => (path === 'notifications/notif-1' ? convergedNotification() : null),
  });

  const result = await runService(brandConfig(), {
    auth: fakeAuth({}), firestore, options: { migration: 'notifications', ids: 'notif-1,missing' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('getDocWithMeta').map((c) => c.args),
    [['notifications/notif-1'], ['notifications/missing']]);
  assert.deepEqual(firestore.of('countDocs'), []);
  assert.deepEqual(firestore.of('listDocs'), []);
  assert.equal(result.output.notifications.totalDocs, 1);
});

test('migrations: --limit caps processed docs and the page size', async () => {
  const docs = [convergedNotification('n1'), convergedNotification('n2'), convergedNotification('n3')];
  const firestore = collectionOf(docs);

  const result = await runService(brandConfig(), {
    auth: fakeAuth({}), firestore, options: { migration: 'notifications', limit: 2 },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('listDocs').map((c) => c.args),
    [['notifications', { pageSize: 2, pageToken: null }]]);
  assert.equal(result.output.notifications.totalDocs, 2);
});

test('migrations: pagination follows nextPageToken across pages', async () => {
  const firestore = fakeFirestore({
    countDocs: 2,
    listDocs: (collection, { pageToken }) => (pageToken
      ? { docs: [convergedNotification('n2')], nextPageToken: null }
      : { docs: [convergedNotification('n1')], nextPageToken: 'page-2' }),
  });

  const result = await runService(brandConfig(), {
    auth: fakeAuth({}), firestore, options: { migration: 'notifications' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(firestore.of('listDocs').map((c) => c.args), [
    ['notifications', { pageSize: 500, pageToken: null }],
    ['notifications', { pageSize: 500, pageToken: 'page-2' }],
  ]);
  assert.equal(result.output.notifications.totalDocs, 2);
});
