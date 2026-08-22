/**
 * Directory service tests (#246) — the entry operation against a method-level
 * recording fake of the Firestore REST client. Proves the three gates (opt-in,
 * a parent to push into, demo-* no-op), the payload shape (identity + the
 * blocks the brand declares, repo slugs from @omega.js/config's ONE derivation),
 * the zero-mutation no-op on an unchanged config, that hub-owned fields on the
 * same document are never touched or counted as drift, and the dry-run
 * zero-mutation guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const service = require('../src/services/directory/index.js');
const { OWNED_SECTIONS } = require('../src/services/directory/lib/blocks.js');

// Tests must never see real credentials from the shell environment
delete process.env.DIRECTORY_SERVICE_ACCOUNT;

const BRAND = { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' };
const PARENT = 'https://parent-brand.test';
const SPONSORSHIPS = {
  acceptable: ['tech', 'marketing'],
  unacceptable: ['gambling'],
  prices: { 'guest-post': 70, 'link-insertion': 50 },
};
const DOC_PATH = `brands/${BRAND.id}`;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function brandConfig({ directory = { enabled: true }, parent = PARENT, sponsorships = SPONSORSHIPS, projectId = 'fixture-brand-prod' } = {}) {
  const config = {
    brand: structuredClone(BRAND),
    cloud: { config: { projectId } },
    repo: { providers: { github: { org: 'fixture-org', repo: 'fixture-org/fixture-brand', shared: false, private: true } } },
    targets: { web: {}, backend: {} },
    // Never publishable — the entry carries identity + declared blocks only
    payment: { products: [{ id: 'premium' }] },
    analytics: { providers: { google: { id: 'G-FIXTURE' } } },
  };
  if (directory !== null) config.directory = structuredClone(directory);
  if (parent !== null) config.parent = parent;
  if (sponsorships !== null) config.sponsorships = structuredClone(sponsorships);
  return config;
}

/** The exact entry the directory should hold for the default fixture. */
function desiredEntry() {
  return {
    brand: structuredClone(BRAND),
    github: { owner: 'fixture-org', name: 'fixture-brand', repo: 'fixture-org/fixture-brand' },
    sponsorships: structuredClone(SPONSORSHIPS),
  };
}

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function fakeDb(responses = {}) {
  const db = { calls: [] };

  for (const method of ['getDoc', 'patchDoc']) {
    db[method] = async (...args) => {
      db.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeDb: unexpected call ${method}(${JSON.stringify(args)})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  db.mutations = () => db.calls.filter((c) => c.method === 'patchDoc');
  db.reads = () => db.calls.filter((c) => c.method === 'getDoc').map((c) => c.args[0]);
  return db;
}

function runService(config, { db, options = {} } = {}) {
  return service.run({
    brandId: BRAND.id,
    brandRoot: '/tmp/omega-manager-directory-unused', // no handler touches disk
    brandConfig: config,
    brand: { id: BRAND.id, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.directory,
    options,
    serviceData: {},
    directoryDb: db,
  });
}

// ─── Registry / defaults pins ────────────────────────────────────────────────

test('directory: registered after server with the entry operation', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('server') + 1], 'directory');
  assert.deepEqual(OPERATIONS.directory.map((o) => o.name), ['entry']);
});

test('directory: defaults are OFF — participation is never implicit', () => {
  assert.deepEqual(DEFAULTS.directory, { enabled: false });
});

// ─── Gate 1: opt-in ──────────────────────────────────────────────────────────

test('directory: no directory config at all means no push', async () => {
  const result = await runService(brandConfig({ directory: null }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /directory\.enabled/);
});

test('directory: directory.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ directory: { enabled: false } }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /directory\.enabled/);
});

test('directory: an empty directory block is not opt-in', async () => {
  // Presence is not consent — only `enabled: true` participates
  const result = await runService(brandConfig({ directory: {} }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /directory\.enabled/);
});

// ─── Gate 2: a parent to push into ───────────────────────────────────────────

test('directory: no parent means there is no directory to push into', async () => {
  const result = await runService(brandConfig({ parent: null }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /parent/);
});

test('directory: parent = false (deliberate opt-out) skips the service', async () => {
  const result = await runService(brandConfig({ parent: false }), { db: fakeDb() });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /parent/);
});

test("directory: parent = 'self' still participates (the parent is in its own directory)", async () => {
  const db = fakeDb({ getDoc: desiredEntry() });
  const result = await runService(brandConfig({ parent: 'self' }), { db });
  assert.equal(result.status, 'success');
  assert.deepEqual(db.reads(), [DOC_PATH]);
});

// ─── Gate 3: demo no-op ──────────────────────────────────────────────────────

test('directory: a demo-* brand no-ops even when it opts in (emulator-only, nothing live to reach)', async () => {
  const db = fakeDb(); // any call at all throws
  const result = await runService(brandConfig({ projectId: 'demo-fixture-brand' }), { db });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /demo-fixture-brand.*emulator-only/);
  assert.deepEqual(db.calls, []);
});

// ─── Credentials ─────────────────────────────────────────────────────────────

test('directory: skips without DIRECTORY_SERVICE_ACCOUNT in .env', async () => {
  const result = await runService(brandConfig()); // no injected db → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /DIRECTORY_SERVICE_ACCOUNT/);
});

// ─── Idempotence ─────────────────────────────────────────────────────────────

test('directory: an entry matching config is a zero-mutation no-op', async () => {
  const db = fakeDb({ getDoc: desiredEntry() });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.deepEqual(db.reads(), [DOC_PATH]);
  assert.equal(result.output.entry.synced, true);
  assert.deepEqual(result.output.entry.blocks, ['sponsorships']);
  // no durable state — the directory doc IS the sync target
  assert.equal(result.state, null);
});

test('directory: key order differences are not drift', async () => {
  const db = fakeDb({
    getDoc: {
      sponsorships: {
        prices: { 'link-insertion': 50, 'guest-post': 70 },
        unacceptable: ['gambling'],
        acceptable: ['tech', 'marketing'],
      },
      github: { repo: 'fixture-org/fixture-brand', name: 'fixture-brand', owner: 'fixture-org' },
      brand: { url: BRAND.url, name: BRAND.name, id: BRAND.id },
    },
  });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
});

test('directory: hub-owned fields on the same document are not drift', async () => {
  // The marketplace keeps its own state on the entry (#246 boundary: the hub
  // is brand code). A converged brand must not rewrite the document because
  // of fields the framework does not own.
  const db = fakeDb({ getDoc: { ...desiredEntry(), orderCount: 12, moderation: { status: 'approved' } } });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
});

// ─── The push ────────────────────────────────────────────────────────────────

test('directory: a missing entry is created with identity + the declared blocks only', async () => {
  const db = fakeDb({ getDoc: null, patchDoc: {} });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations().map((c) => c.args), [[DOC_PATH, desiredEntry(), OWNED_SECTIONS]]);
  assert.equal(result.output.entry.created, true);
});

test('directory: the write masks only the framework-owned sections', async () => {
  const db = fakeDb({ getDoc: null, patchDoc: {} });

  await runService(brandConfig(), { db });

  // A merge write, never a replace: everything the hub owns survives, and a
  // section dropped from config is still removed (its path stays in the mask).
  assert.deepEqual(db.mutations()[0].args[2], ['brand', 'github', 'sponsorships']);
});

test('directory: a changed sponsorship price is drift and is pushed', async () => {
  const stale = desiredEntry();
  stale.sponsorships.prices['guest-post'] = 30;
  const db = fakeDb({ getDoc: stale, patchDoc: {} });

  const result = await runService(brandConfig(), { db });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations().map((c) => c.args), [[DOC_PATH, desiredEntry(), OWNED_SECTIONS]]);
  assert.equal(result.output.entry.updated, true);
});

test('directory: drifted brand identity is pushed', async () => {
  const stale = desiredEntry();
  stale.brand.name = 'Old Name';
  const db = fakeDb({ getDoc: stale, patchDoc: {} });

  const result = await runService(brandConfig(), { db });

  assert.deepEqual(db.mutations().map((c) => c.args[1]), [desiredEntry()]);
});

test('directory: an undeclared block is omitted from the entry (and its removal is masked)', async () => {
  const db = fakeDb({ getDoc: desiredEntry(), patchDoc: {} });

  const result = await runService(brandConfig({ sponsorships: null }), { db });

  assert.equal(result.status, 'success');
  const [path, data, mask] = db.mutations()[0].args;
  assert.equal(path, DOC_PATH);
  assert.deepEqual(Object.keys(data), ['brand', 'github']);
  assert.ok(mask.includes('sponsorships'), 'the mask still names the dropped block, so the directory loses it too');
  assert.deepEqual(result.output.entry.blocks, []);
});

test('directory: an empty sponsorships block is not a declared block', async () => {
  const db = fakeDb({ getDoc: null, patchDoc: {} });

  await runService(brandConfig({ sponsorships: {} }), { db });

  assert.deepEqual(Object.keys(db.mutations()[0].args[1]), ['brand', 'github']);
});

test('directory: repo slugs come from the shared derivation, not a local one', async () => {
  const config = brandConfig();
  // Bare name + org: the #290 derivation resolves the owner from repo.providers.github.org
  config.repo.providers.github.repo = 'renamed-repo';
  const db = fakeDb({ getDoc: null, patchDoc: {} });

  await runService(config, { db });

  assert.deepEqual(db.mutations()[0].args[1].github, {
    owner: 'fixture-org',
    name: 'renamed-repo',
    repo: 'fixture-org/renamed-repo',
  });
});

test('directory: an unresolvable repo is omitted rather than pushed half-formed', async () => {
  const config = brandConfig();
  delete config.repo; // no org, no slug → owner cannot resolve
  const db = fakeDb({ getDoc: null, patchDoc: {} });

  await runService(config, { db });

  assert.deepEqual(Object.keys(db.mutations()[0].args[1]), ['brand', 'sponsorships']);
});

test('directory: a brand with no url pushes identity without one', async () => {
  const config = brandConfig();
  delete config.brand.url;
  const db = fakeDb({ getDoc: null, patchDoc: {} });

  await runService(config, { db });

  assert.deepEqual(db.mutations()[0].args[1].brand, { id: BRAND.id, name: BRAND.name });
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('directory: dry run on a drifted entry performs zero mutations', async () => {
  const stale = desiredEntry();
  stale.brand.url = 'https://old-url.test';
  const db = fakeDb({ getDoc: stale });

  const result = await runService(brandConfig(), { db, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.entry.planned, 'update');
  assert.equal(result.state, null);
});

test('directory: dry run on a missing entry plans a create', async () => {
  const db = fakeDb({ getDoc: null });

  const result = await runService(brandConfig(), { db, options: { dryRun: true } });

  assert.deepEqual(db.mutations(), []);
  assert.equal(result.output.entry.planned, 'create');
});
