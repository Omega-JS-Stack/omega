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
 * The lane SKIPS (never fails) without the firebase CLI or a JVM, matching how
 * every other emulator-dependent lane in this repo handles a missing tool.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { OPERATIONS } = require('../src/config.js');
const { encodeFields, decodeFields } = require('../src/lib/firestore-rest.js');
const service = require('../src/services/directory/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.DIRECTORY_SERVICE_ACCOUNT;

const PROJECT_ID = 'demo-omega-directory';
const BRAND_ID = 'emulator-brand';
const DOC_PATH = `brands/${BRAND_ID}`;
const READY_TIMEOUT_MS = Number(process.env.OMEGA_EMULATOR_READY_TIMEOUT || 180000);

// ─── Tool availability ───────────────────────────────────────────────────────

/** @returns {string|null} Why this lane cannot run, or null when it can. */
function missingTool() {
  const firebase = spawnSync('firebase', ['--version'], { stdio: 'ignore' });
  if (firebase.error || firebase.status !== 0) {
    return 'the firebase CLI is not on PATH';
  }

  const java = spawnSync('java', ['-version'], { stdio: 'ignore' });
  if (java.error || java.status !== 0) {
    return 'no JVM is installed (the Firestore emulator is a java process)';
  }

  return null;
}

// ─── Emulator lifecycle ──────────────────────────────────────────────────────

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Boot a standalone Firestore emulator in its own throwaway project dir.
 *
 * @returns {Promise<{ port: number, dir: string, stop: Function }>}
 */
async function startEmulator() {
  const port = await freePort();
  const dir = jetpack.tmpDir({ prefix: 'omega-directory-emulator' }).cwd();

  jetpack.write(join(dir, 'firebase.json'), {
    emulators: { firestore: { host: '127.0.0.1', port }, ui: { enabled: false } },
    firestore: { rules: 'firestore.rules' },
  });
  // The push is server-side tooling; client access is denied exactly as the
  // real parent project's rules deny it.
  jetpack.write(
    join(dir, 'firestore.rules'),
    'rules_version = "2";\nservice cloud.firestore {\n  match /databases/{db}/documents {\n    match /{document=**} { allow read, write: if false; }\n  }\n}\n',
  );

  const child = spawn(
    'firebase',
    ['emulators:start', '--only', 'firestore', '--project', PROJECT_ID],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const output = [];
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Firestore emulator never reported ready in ${READY_TIMEOUT_MS}ms:\n${output.join('')}`)),
      READY_TIMEOUT_MS,
    );

    const watch = (chunk) => {
      output.push(String(chunk));
      if (output.join('').includes('All emulators ready')) {
        clearTimeout(timer);
        resolve();
      }
    };

    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Firestore emulator exited with code ${code}:\n${output.join('')}`));
    });
  });

  await ready;

  return {
    port,
    dir,
    stop: () => new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
    }),
  };
}

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
    parent: 'https://parent-brand.test',
    directory: { enabled: true },
    cloud: { config: { projectId: 'emulator-brand-prod' } },
    repo: { providers: { github: { org: 'emulator-org' } } },
    sponsorships: {
      acceptable: ['tech'],
      unacceptable: ['gambling'],
      prices: { 'guest-post': guestPostPrice, 'link-insertion': 50 },
    },
    targets: { web: {}, backend: {} },
  };
}

function runService(config, db) {
  return service.run({
    brandId: BRAND_ID,
    brandRoot: '/tmp/omega-manager-directory-emulator-unused',
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

test('directory: a config price change lands in the parent doc; an unchanged config writes nothing', laneOptions, async (t) => {
  const emulator = await startEmulator();
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
  assert.deepEqual(doc.github, { owner: 'emulator-org', name: BRAND_ID, repo: `emulator-org/${BRAND_ID}` });
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
