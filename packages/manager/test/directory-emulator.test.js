/**
 * Directory service against a REAL Firestore emulator (#246) — the
 * service-level proof the fake-client suite in directory.test.js cannot give:
 * that a config price change actually LANDS in the parent document, and that
 * an unchanged config leaves it byte-for-byte alone (asserted on the server's
 * own updateTime, not on a call count this test controls).
 *
 * The client is a thin harness over the SAME wire encoding production uses —
 * `encodeFields`/`decodeFields` from src/lib/firestore-rest.js — pointed at
 * the emulator's REST endpoint, which takes `Bearer owner` in place of the
 * service-account JWT. Everything above it is the real service: the real
 * setup gates, the real runner, the real diff, the real updateMask.
 *
 * The emulator itself — boot, ready-watch, and the teardown that lets node
 * exit (#440) — is test/lib/emulator.js. The lane SKIPS (never fails) without
 * the firebase CLI or a JVM, matching how every other emulator-dependent lane
 * in this repo handles a missing tool.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');

// The machine home is a temp dir for this file: the parent brand below is
// registered in a REGISTRY, and a fixture line must never land in the
// developer's own (#677).
require('./lib/temp-home.js');

const { recordBrand, resolveCompany } = require('@omega.js/config');

const { OPERATIONS } = require('../src/config.js');
const { encodeFields, decodeFields } = require('../src/lib/firestore-rest.js');
const service = require('../src/services/directory/index.js');
const { missingTool, startEmulator } = require('./lib/emulator.js');

// Tests must never see real credentials from the shell environment
delete process.env.DIRECTORY_SERVICE_ACCOUNT;

const PROJECT_ID = 'demo-omega-directory';
const BRAND_ID = 'emulator-brand';
const DOC_PATH = `brands/${BRAND_ID}`;
const COMPANY_ID = 'parent-brand';

// The parent this brand names, and the registry line the parent's own walk
// writes (#677): `company: { id }` is the whole relationship, and the id
// resolves through the machine registry rather than through a url.
const BRAND_ROOT = jetpack.tmpDir({ prefix: 'omega-directory-emulator-brand-' }).cwd();
const COMPANY_ROOT = jetpack.tmpDir({ prefix: 'omega-directory-emulator-company-' }).cwd();

jetpack.write(path.join(COMPANY_ROOT, 'config', 'omega.json5'), JSON.stringify({
  brand: { id: COMPANY_ID, name: 'Parent Brand', url: 'https://parent-brand.test' },
}, null, 2));
recordBrand({ id: COMPANY_ID, root: COMPANY_ROOT, name: 'Parent Brand', url: 'https://parent-brand.test' });

// ─── The client under the service ────────────────────────────────────────────

/**
 * The FirestoreREST method surface, spoken to the emulator. Same encoding as
 * production; the emulator's owner token stands in for the JWT grant.
 *
 * @param {number} port - The emulator's Firestore port.
 * @returns {object} getDoc/patchDoc plus a `writes` counter and updateTime read.
 */
function emulatorClient(port) {
  const base = `http://127.0.0.1:${port}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const headers = { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' };
  const client = { writes: 0 };

  async function raw(docPath) {
    const response = await fetch(`${base}/${docPath}`, { headers });
    return response.status === 404 ? null : response.json();
  }

  client.getDoc = async (docPath) => {
    const doc = await raw(docPath);
    return doc ? decodeFields(doc.fields || {}) : null;
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

  /** Seed a document directly — how the hub's own fields get onto the entry. */
  client.seed = (docPath, data) => fetch(`${base}/${docPath}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields: encodeFields(data) }),
  });

  client.updateTime = async (docPath) => (await raw(docPath))?.updateTime || null;

  return client;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig(guestPostPrice) {
  return {
    brand: { id: BRAND_ID, name: 'Emulator Brand', url: 'https://emulator-brand.test' },
    company: { id: COMPANY_ID },
    directory: { enabled: true },
    cloud: { config: { projectId: 'emulator-brand-prod' } },
    repo: { provider: 'github', org: 'emulator-org' },
    sponsorships: {
      acceptable: ['tech'],
      unacceptable: ['gambling'],
      prices: { 'guest-post': guestPostPrice, 'link-insertion': 50 },
    },
    targets: { web: { type: 'web' }, backend: { type: 'backend' } },
  };
}

function runService(config, db) {
  return service.run({
    brandId: BRAND_ID,
    brandRoot: BRAND_ROOT,
    brandConfig: config,
    brand: { id: BRAND_ID, config, enabledTargets: Object.keys(config.targets), targets: [] },
    targets: [],
    operations: OPERATIONS.directory,
    options: {},
    serviceData: {},
    directoryDb: db,
  });
}

// ─── The fixture's own proof (no emulator) ───────────────────────────────────

test('the fixture names its parent the way a brand does: company.id resolves through the registry (#677)', () => {
  const company = resolveCompany(BRAND_ROOT, brandConfig(70));

  assert.equal(company.id, COMPANY_ID);
  assert.equal(company.root, COMPANY_ROOT, 'the registered parent root is what the resolver answers');
  assert.equal(company.name, 'Parent Brand');
});

// ─── The lane ────────────────────────────────────────────────────────────────

const unavailable = missingTool();
// `skip` must be ABSENT to run: node's runner reports `skip: null` as SKIP
// even though it still executes the body — a green-looking lane that proved
// nothing.
const laneOptions = unavailable ? { skip: unavailable } : {};

test('directory: a config price change lands in the parent doc; an unchanged config writes nothing', laneOptions, async (t) => {
  const emulator = await startEmulator({ projectId: PROJECT_ID, prefix: 'omega-directory-emulator' });
  t.after(async () => {
    await emulator.stop();
    jetpack.remove(emulator.dir);
  });

  const db = emulatorClient(emulator.port);

  // The hub's own field on the entry: it must survive every push (#246 —
  // the framework owes the entry, the marketplace owns everything else).
  await db.seed(DOC_PATH, { orderCount: 7 });

  // ── First walk: the entry is created ──────────────────────────────────────
  const created = await runService(brandConfig(70), db);
  assert.equal(created.status, 'success');
  assert.equal(created.output.entry.updated, true, 'the seeded doc already existed, so this is an update');

  let doc = await db.getDoc(DOC_PATH);
  assert.equal(doc.sponsorships.prices['guest-post'], 70);
  assert.deepEqual(doc.brand, { id: BRAND_ID, name: 'Emulator Brand', url: 'https://emulator-brand.test' });
  assert.deepEqual(doc.github, { owner: 'emulator-org', name: `${BRAND_ID}-omega`, slug: `emulator-org/${BRAND_ID}-omega` });
  assert.equal(doc.orderCount, 7, 'the hub-owned field survived the push');

  // ── Second walk, unchanged config: zero writes, untouched document ────────
  const settled = await db.updateTime(DOC_PATH);
  const writesBefore = db.writes;

  const rerun = await runService(brandConfig(70), db);
  assert.equal(rerun.status, 'success');
  assert.equal(rerun.output.entry.synced, true);
  assert.equal(db.writes, writesBefore, 'an unchanged config performs no write');
  assert.equal(await db.updateTime(DOC_PATH), settled, 'the parent document was not touched');

  // ── Third walk, a price change: it lands ──────────────────────────────────
  const changed = await runService(brandConfig(95), db);
  assert.equal(changed.output.entry.updated, true);
  assert.equal(db.writes, writesBefore + 1, 'exactly one write for one change');

  doc = await db.getDoc(DOC_PATH);
  assert.equal(doc.sponsorships.prices['guest-post'], 95, 'the new price is live in the parent doc');
  assert.equal(doc.sponsorships.prices['link-insertion'], 50, 'the untouched placement kept its price');
  assert.equal(doc.orderCount, 7, 'the hub-owned field survived again');

  // ── Fourth walk: converged again ─────────────────────────────────────────
  const converged = await runService(brandConfig(95), db);
  assert.equal(converged.output.entry.synced, true);
  assert.equal(db.writes, writesBefore + 1, 'the push is idempotent');
});

if (unavailable) {
  console.log(`directory-emulator: SKIPPED — ${unavailable}`);
}
