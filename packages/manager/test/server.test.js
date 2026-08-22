/**
 * Server service tests — the brands operation against a method-level
 * recording fake of the Firestore REST client. Proves skip semantics, the
 * converged zero-mutation no-op (key-order-insensitive), the whitelist
 * (only brand/github/sponsorships cross, absent sections omitted), the
 * full-replace write on drift including stale-key removal (omega-manager's
 * merge:false semantic — but it overwrote blindly on every run; the port
 * reads first), and the dry-run zero-mutation guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/server/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.SERVER_SERVICE_ACCOUNT;

const BRAND = { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' };
const GITHUB = { shared: false, private: true };
const SPONSORSHIPS = {
  acceptable: ['tech', 'marketing'],
  unacceptable: ['spam'],
  prices: { 'guest-post': 70, 'link-insertion': 50 },
};
const DOC_PATH = `brands/${BRAND.id}`;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ server = {}, sponsorships = SPONSORSHIPS } = {}) {
  const config = {
    brand: structuredClone(BRAND),
    repo: { providers: { github: structuredClone(GITHUB) } },
    server: server === false ? false : { ...structuredClone(DEFAULTS.server), ...server },
    targets: { web: {}, backend: {} },
    // Non-whitelisted sections — must never reach the registry
    payment: { products: [{ id: 'premium' }] },
    analytics: { providers: { google: { id: 'G-FIXTURE' } } },
  };
  if (sponsorships !== null) {
    config.sponsorships = structuredClone(sponsorships);
  }
  return config;
}

/** The exact document the registry should hold for the default fixture. */
function desiredDoc() {
  return { brand: structuredClone(BRAND), repo: { providers: { github: structuredClone(GITHUB) } }, sponsorships: structuredClone(SPONSORSHIPS) };
}

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function fakeDb(responses = {}) {
  const db = { calls: [] };

  for (const method of ['getDoc', 'setDoc']) {
    db[method] = async (...args) => {
      db.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeDb: unexpected call ${method}(${JSON.stringify(args)})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  db.mutations = () => db.calls.filter((c) => c.method === 'setDoc');
  db.reads = () => db.calls.filter((c) => c.method === 'getDoc').map((c) => c.args[0]);
  return db;
}

function runService(config, { db, options = {} } = {}) {
  return service.run({
    brandId: BRAND.id,
    brandRoot: '/tmp/omega-manager-server-unused', // no handler touches disk
    brandConfig: config,
    brand: { id: BRAND.id, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.server,
    options,
    serviceData: {},
    serverDb: db,
  });
}

// ─── Registry / defaults pins ────────────────────────────────────────────────

test('server: registered after email with the brands operation', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('email') + 1], 'server');
  assert.deepEqual(OPERATIONS.server.map((o) => o.name), ['brands']);
});

test('server: defaults are enabled-only (project comes from the service account)', () => {
  assert.deepEqual(DEFAULTS.server, { enabled: true });
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('server: server.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ server: { enabled: false } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /server\.enabled/);
});

test('server: scalar server: false skips the service', async () => {
  const result = await runService(brandConfig({ server: false }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /server\.enabled/);
});

test('server: skips without SERVER_SERVICE_ACCOUNT in .env', async () => {
  const result = await runService(brandConfig()); // no injected db → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /SERVER_SERVICE_ACCOUNT/);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('server: a registry entry matching config is a zero-mutation no-op', async () => {
  const db = fakeDb({ getDoc: desiredDoc() });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.deepEqual(db.reads(), [DOC_PATH]);
  assert.equal(result.output.brands.synced, true);
  // no durable state — the registry doc IS the sync target
  assert.equal(result.state, null);
});

test('server: key order differences are not drift', async () => {
  // Same content as desiredDoc(), every level reordered
  const db = fakeDb({
    getDoc: {
      sponsorships: {
        prices: { 'link-insertion': 50, 'guest-post': 70 },
        unacceptable: ['spam'],
        acceptable: ['tech', 'marketing'],
      },
      repo: { providers: { github: { private: true, shared: false } } },
      brand: { url: BRAND.url, name: BRAND.name, id: BRAND.id },
    },
  });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
});

// ─── brands ──────────────────────────────────────────────────────────────────

test('server: a missing registry entry is created with ONLY the whitelisted sections', async () => {
  const db = fakeDb({ getDoc: null, setDoc: {} });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  // Exact full-document write: payment/analytics/targets/server never cross
  assert.deepEqual(db.mutations().map((c) => c.args), [[DOC_PATH, desiredDoc()]]);
  assert.equal(result.output.brands.created, true);
});

test('server: an absent sponsorships section is omitted from the document', async () => {
  const db = fakeDb({ getDoc: null, setDoc: {} });

  const result = await runService(brandConfig({ sponsorships: null }), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations()[0].args[1], { brand: BRAND, repo: { providers: { github: GITHUB } } });
});

test('server: drifted brand data is replace-written with the full document', async () => {
  const stale = desiredDoc();
  stale.brand.name = 'Old Name';
  const db = fakeDb({ getDoc: stale, setDoc: {} });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations().map((c) => c.args), [[DOC_PATH, desiredDoc()]]);
  assert.equal(result.output.brands.updated, true);
});

test('server: a stale key in the registry entry is drift (replace removes it)', async () => {
  // Every desired field matches — only an extra leftover key differs. A
  // merge-style compare would call this converged; the full-replace
  // semantic must rewrite the document so the stale key disappears.
  const db = fakeDb({ getDoc: { ...desiredDoc(), legacy: true }, setDoc: {} });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations().map((c) => c.args), [[DOC_PATH, desiredDoc()]]);
});

test('server: a changed sponsorship price is drift', async () => {
  const stale = desiredDoc();
  stale.sponsorships.prices['guest-post'] = 30;
  const db = fakeDb({ getDoc: stale, setDoc: {} });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.equal(db.mutations().length, 1);
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('server: dry run on a drifted entry performs zero mutations', async () => {
  const stale = desiredDoc();
  stale.brand.url = 'https://old-url.test';
  const db = fakeDb({ getDoc: stale });

  const result = await runService(brandConfig(), { db, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.brands.planned, 'update');
  assert.equal(result.state, null);
});

test('server: dry run on a missing entry plans a create', async () => {
  const db = fakeDb({ getDoc: null });

  const result = await runService(brandConfig(), { db, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.brands.planned, 'create');
});
