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
const defineCases = require('@omega.js/devkit/test/define-cases');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');

// The machine home is a temp dir for this file: the parent brand below is
// registered in a REGISTRY, and a fixture line must never land in the
// developer's own (#677).
require('@omega.js/devkit/test/temp-home');

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
    repo: { provider: 'github', owner: 'emulator-org' },
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

// ─── The lane ────────────────────────────────────────────────────────────────

const unavailable = missingTool();
// `skip` must be ABSENT to run: node's runner reports `skip: null` as SKIP
// even though it still executes the body — a green-looking lane that proved
// nothing.
const laneOptions = unavailable ? { skip: unavailable } : {};

if (unavailable) {
  console.log(`directory-emulator: SKIPPED — ${unavailable}`);
}

module.exports = defineCases({
  type: 'group',
  description: 'directory-emulator',
  tests: [
    // ─── The fixture's own proof (no emulator) ───────────────────────────────────

    {
      name: 'the fixture names its parent the way a brand does: company.id resolves through the registry (#677)',
      run: (ctx) => {
        const company = resolveCompany(BRAND_ROOT, brandConfig(70));

        ctx.expect(company.id).toBe(COMPANY_ID);
        ctx.expect(company.root, 'the registered parent root is what the resolver answers').toBe(COMPANY_ROOT);
        ctx.expect(company.name).toBe('Parent Brand');
      },
    },

    {
      name: 'directory: a config price change lands in the parent doc; an unchanged config writes nothing',
      ...laneOptions,
      run: async (ctx) => {
        const emulator = await startEmulator({ projectId: PROJECT_ID, prefix: 'omega-directory-emulator' });
        ctx.after(async () => {
          await emulator.stop();
          jetpack.remove(emulator.dir);
        });

        const db = emulatorClient(emulator.port);

        // The hub's own field on the entry: it must survive every push (#246 —
        // the framework owes the entry, the marketplace owns everything else).
        await db.seed(DOC_PATH, { orderCount: 7 });

        // ── First walk: the entry is created ──────────────────────────────────────
        const created = await runService(brandConfig(70), db);
        ctx.expect(created.status).toBe('success');
        ctx.expect(created.output.entry.updated, 'the seeded doc already existed, so this is an update').toBe(true);

        let doc = await db.getDoc(DOC_PATH);
        ctx.expect(doc.sponsorships.prices['guest-post']).toBe(70);
        ctx.expect(doc.brand).toEqual({ id: BRAND_ID, name: 'Emulator Brand', url: 'https://emulator-brand.test' });
        ctx.expect(doc.github).toEqual({ owner: 'emulator-org', name: `${BRAND_ID}-omega`, slug: `emulator-org/${BRAND_ID}-omega` });
        ctx.expect(doc.orderCount, 'the hub-owned field survived the push').toBe(7);

        // ── Second walk, unchanged config: zero writes, untouched document ────────
        const settled = await db.updateTime(DOC_PATH);
        const writesBefore = db.writes;

        const rerun = await runService(brandConfig(70), db);
        ctx.expect(rerun.status).toBe('success');
        ctx.expect(rerun.output.entry.synced).toBe(true);
        ctx.expect(db.writes, 'an unchanged config performs no write').toBe(writesBefore);
        ctx.expect(await db.updateTime(DOC_PATH), 'the parent document was not touched').toBe(settled);

        // ── Third walk, a price change: it lands ──────────────────────────────────
        const changed = await runService(brandConfig(95), db);
        ctx.expect(changed.output.entry.updated).toBe(true);
        ctx.expect(db.writes, 'exactly one write for one change').toBe(writesBefore + 1);

        doc = await db.getDoc(DOC_PATH);
        ctx.expect(doc.sponsorships.prices['guest-post'], 'the new price is live in the parent doc').toBe(95);
        ctx.expect(doc.sponsorships.prices['link-insertion'], 'the untouched placement kept its price').toBe(50);
        ctx.expect(doc.orderCount, 'the hub-owned field survived again').toBe(7);

        // ── Fourth walk: converged again ─────────────────────────────────────────
        const converged = await runService(brandConfig(95), db);
        ctx.expect(converged.output.entry.synced).toBe(true);
        ctx.expect(db.writes, 'the push is idempotent').toBe(writesBefore + 1);
      },
    },
  ],
});
