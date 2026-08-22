/**
 * The payment-provider backfill (#428) against a REAL Firestore emulator —
 * the verification lane the migration owes before it is ever pointed at a live
 * project. The fake-client suite in migrations.test.js pins the PATCH the
 * migration constructs; this proves the patch, applied by an actual Firestore
 * server, lands the documents in the shape the renamed code reads.
 *
 * Both halves of the write gate run here: the default AUDIT pass (counts what
 * it would change, and the server's own updateTime proves it wrote nothing),
 * then `--execute`, then a third pass proving the migration is idempotent.
 *
 * The client is a thin harness over the SAME wire encoding production uses —
 * `encodeFields`/`decodeFields` from src/lib/firestore-rest.js — pointed at
 * the emulator's REST endpoint, which takes `Bearer owner` in place of the
 * service-account JWT (the shape directory-emulator.test.js established).
 * Everything above it is the real service: the real setup gates, the real
 * runner, the real fix, the real updateMask.
 *
 * The emulator itself — boot, ready-watch, and the teardown that lets node
 * exit (#440) — is test/lib/emulator.js. The lane SKIPS (never fails) without
 * the firebase CLI or a JVM, matching how every other emulator-dependent lane
 * in this repo handles a missing tool.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const jetpack = require('fs-jetpack');

const { OPERATIONS } = require('../src/config.js');
const { encodeFields, decodeFields } = require('../src/lib/firestore-rest.js');
const service = require('../src/services/migrations/index.js');
const { missingTool, startEmulator } = require('./lib/emulator.js');

const PROJECT_ID = 'demo-omega-migrations';
const BRAND_ID = 'emulator-brand';

// ─── The client under the service ────────────────────────────────────────────

/**
 * The FirestoreREST method surface the migration runner calls, spoken to the
 * emulator. Same encoding as production; the emulator's owner token stands in
 * for the JWT grant.
 *
 * @param {number} port - The emulator's Firestore port.
 * @returns {object} countDocs/listDocs/getDocWithMeta/patchDoc/deleteDoc plus a `writes` counter.
 */
function emulatorClient(port) {
  const root = `http://127.0.0.1:${port}/v1/projects/${PROJECT_ID}/databases/(default)`;
  const base = `${root}/documents`;
  const headers = { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' };
  const client = { writes: 0, projectId: PROJECT_ID };

  async function raw(docPath) {
    const response = await fetch(`${base}/${docPath}`, { headers });
    return response.status === 404 ? null : response.json();
  }

  const withMeta = (doc) => ({
    id: doc.name.split('/').pop(),
    createTime: doc.createTime,
    updateTime: doc.updateTime,
    data: decodeFields(doc.fields || {}),
  });

  client.listDocs = async (collectionPath, { pageSize = 500, pageToken } = {}) => {
    const url = new URL(`${base}/${collectionPath}`);
    url.searchParams.set('pageSize', String(pageSize));
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    const data = (await (await fetch(url, { headers })).json()) || {};

    return { docs: (data.documents || []).map(withMeta), nextPageToken: data.nextPageToken || null };
  };

  client.countDocs = async (collectionId) => (await client.listDocs(collectionId)).docs.length;

  client.getDocWithMeta = async (docPath) => {
    const doc = await raw(docPath);
    return doc ? withMeta(doc) : null;
  };

  client.patchDoc = async (docPath, data, fieldPaths) => {
    client.writes += 1;
    const url = new URL(`${base}/${docPath}`);
    for (const path of fieldPaths) {
      url.searchParams.append('updateMask.fieldPaths', path);
    }
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: encodeFields(data) }),
    });
    if (!response.ok) {
      throw new Error(`Firestore emulator error: ${await response.text()}`);
    }
    return response.json();
  };

  client.deleteDoc = async (docPath) => fetch(`${base}/${docPath}`, { method: 'DELETE', headers });

  /** Seed a document directly — how the pre-cutover data got there. */
  client.seed = (docPath, data) => fetch(`${base}/${docPath}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields: encodeFields(data) }),
  });

  client.read = async (docPath) => {
    const doc = await raw(docPath);
    return doc ? decodeFields(doc.fields || {}) : null;
  };

  client.updateTime = async (docPath) => (await raw(docPath))?.updateTime || null;

  return client;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// One document per collection the migration sweeps, in the PRE-#428 shape the
// live projects hold, plus a dispute whose own `provider` (the alert source)
// must survive untouched beside the payment provider it carries.
const LEGACY = {
  'users/uid-legacy': { id: 'uid-legacy', subscription: { status: 'active', payment: { processor: 'stripe', resourceId: 'sub_1' } } },
  'payments-orders/order-legacy': { id: 'order-legacy', owner: 'uid-legacy', processor: 'paypal' },
  'payments-intents/intent-legacy': { id: 'intent-legacy', owner: 'uid-legacy', processor: 'chargebee' },
  'payments-webhooks/evt-legacy': { id: 'evt-legacy', processor: 'stripe', eventType: 'invoice.paid' },
  'payments-disputes/alert-legacy': { id: 'alert-legacy', provider: 'chargeblast', alert: { processor: 'stripe', subprovider: 'Ethoca' } },
};

// Written by the post-cutover code — nothing to do on any pass.
const CONVERGED = {
  'users/uid-current': { id: 'uid-current', subscription: { status: 'active', payment: { provider: 'stripe', resourceId: 'sub_2' } } },
  'payments-orders/order-current': { id: 'order-current', owner: 'uid-current', provider: 'stripe' },
};

function brandConfig() {
  return {
    brand: { id: BRAND_ID, name: 'Emulator Brand', url: 'https://emulator-brand.test' },
    targets: { web: {}, backend: {} },
    cloud: { shared: false },
  };
}

function runMigrations(root, firestore, options) {
  return service.run({
    brandId: BRAND_ID,
    brandRoot: root,
    brandConfig: brandConfig(),
    operations: OPERATIONS.migrations,
    options,
    serviceData: {},
    authAdmin: {},
    firestore,
  });
}

// ─── The lane ────────────────────────────────────────────────────────────────

const unavailable = missingTool();
// `skip` must be ABSENT to run: node's runner reports `skip: null` as SKIP
// even though it still executes the body — a green-looking lane that proved
// nothing.
const laneOptions = unavailable ? { skip: unavailable } : {};

test('payment-provider: the audit writes nothing, --execute lands every collection, a rerun is a no-op', laneOptions, async (t) => {
  const emulator = await startEmulator({ projectId: PROJECT_ID, prefix: 'omega-migrations-emulator' });
  const root = jetpack.tmpDir({ prefix: 'omega-migrations-brand' }).cwd();
  t.after(async () => {
    await emulator.stop();
    jetpack.remove(emulator.dir);
    jetpack.remove(root);
  });

  const db = emulatorClient(emulator.port);

  for (const [path, data] of Object.entries({ ...LEGACY, ...CONVERGED })) {
    await db.seed(path, data);
  }

  // ── Pass 1: the AUDIT. Counts the work, touches nothing ───────────────────
  const settled = {};
  for (const path of Object.keys(LEGACY)) {
    settled[path] = await db.updateTime(path);
  }

  const audit = await runMigrations(root, db, { migration: 'payment-provider' });

  assert.equal(audit.status, 'success');
  assert.equal(db.writes, 0, 'the audit performed no write');
  for (const [path, at] of Object.entries(settled)) {
    assert.equal(await db.updateTime(path), at, `${path} was not touched`);
    assert.deepEqual(await db.read(path), LEGACY[path], `${path} still holds the pre-cutover shape`);
  }
  assert.equal(audit.output['payment-provider:users'].docsFixed, 1, 'one of the two users needs the rename');
  assert.equal(audit.output['payment-provider:users'].totalDocs, 2);
  assert.equal(audit.output['payment-provider:payments-disputes'].docsFixed, 1);

  // ── Pass 2: --execute. The rename lands on the server ─────────────────────
  const executed = await runMigrations(root, db, { migration: 'payment-provider', execute: true });

  assert.equal(executed.status, 'success');
  assert.equal(db.writes, 5, 'exactly one write per legacy document, and none for the converged pair');

  const user = await db.read('users/uid-legacy');
  assert.equal(user.subscription.payment.provider, 'stripe');
  assert.equal('processor' in user.subscription.payment, false, 'the retired key is gone from the server document');
  assert.equal(user.subscription.payment.resourceId, 'sub_1', 'the sibling field survived the masked patch');
  assert.equal(user.subscription.status, 'active');

  assert.deepEqual(await db.read('payments-orders/order-legacy'), { id: 'order-legacy', owner: 'uid-legacy', provider: 'paypal' });
  assert.deepEqual(await db.read('payments-intents/intent-legacy'), { id: 'intent-legacy', owner: 'uid-legacy', provider: 'chargebee' });
  assert.deepEqual(await db.read('payments-webhooks/evt-legacy'), { id: 'evt-legacy', provider: 'stripe', eventType: 'invoice.paid' });

  const dispute = await db.read('payments-disputes/alert-legacy');
  assert.equal(dispute.alert.provider, 'stripe', 'the PAYMENT provider moved onto the new word');
  assert.equal('processor' in dispute.alert, false);
  assert.equal(dispute.provider, 'chargeblast', 'the ALERT source is a different field and is untouched');
  assert.equal(dispute.alert.subprovider, 'Ethoca', "Chargeblast's own sibling field survived");

  // The converged pair was never written, so it is byte-identical
  assert.deepEqual(await db.read('users/uid-current'), CONVERGED['users/uid-current']);
  assert.deepEqual(await db.read('payments-orders/order-current'), CONVERGED['payments-orders/order-current']);

  // ── Pass 3: idempotent. A converged brand writes nothing ──────────────────
  const writesBefore = db.writes;
  const rerun = await runMigrations(root, db, { migration: 'payment-provider', execute: true });

  assert.equal(rerun.status, 'success');
  assert.equal(db.writes, writesBefore, 'a second --execute is a strict no-op');
  assert.equal(rerun.output['payment-provider:users'].docsFixed, 0);
  assert.equal(rerun.output['payment-provider:payments-orders'].docsFixed, 0);
});
