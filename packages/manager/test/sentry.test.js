/**
 * Sentry service tests — both operations against a method-level recording
 * fake of the Sentry client, with the config writeback REAL (temp brand
 * roots via the shared config fixture). Proves skip semantics, org
 * resolution (config wins / lone-org self-heal / multi-org warn), the
 * region repoint, per-target project creation with the right platforms,
 * the converged zero-mutation byte-identical no-op, DSN drift patching,
 * and the dry-run zero-mutation guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { SERVICE_ORDER, OPERATIONS } = require('../src/config.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const service = require('../src/services/sentry/index.js');

// Tests must never see real credentials from the shell environment
delete process.env.SENTRY_AUTH_TOKEN;

const ORG = { slug: 'fixture-org', links: { regionUrl: 'https://us.sentry.io' } };
const ALL_TARGETS = { web: {}, backend: {}, desktop: {}, extension: {} };
const PLATFORMS = { web: 'javascript', backend: 'node', desktop: 'javascript-electron', extension: 'javascript' };

function dsnOf(target) {
  return `https://key-${target}@o1.ingest.us.sentry.io/${target.length}00`;
}

function projectRecord(target) {
  return { id: `proj-${target}`, slug: `fixture-brand-${target}` };
}

function keysFor(target) {
  return [{ isActive: true, dsn: { public: dsnOf(target) } }];
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const WRITEBACK_CONFIG = `// Fixture Brand — hand-edited writeback target
{
  brand: {
    id: 'fixture-brand', // stays single-quoted
    name: "Fixture Brand",
  },
  monitoring: {
    provider: "sentry",
    dsn: null,
  },
  targets: {
    web: {},
    backend: {},
    desktop: {},
    extension: {},
  },
}
`;

function brandConfig({ monitoring = { provider: 'sentry' }, targets = structuredClone(ALL_TARGETS) } = {}) {
  return {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
    monitoring,
    targets,
  };
}

const READ_METHODS = ['getOrganizations', 'getTeams', 'getProjects', 'getProjectKeys'];
const MUTATING_METHODS = ['createTeam', 'createProject'];

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function fakeSentry(responses = {}) {
  const api = { calls: [], regionUrls: [] };

  api.setRegionUrl = (url) => { api.regionUrls.push(url); };

  for (const method of [...READ_METHODS, ...MUTATING_METHODS]) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeSentry: unexpected call ${method}(${JSON.stringify(args)})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  api.mutations = () => api.calls.filter((call) => MUTATING_METHODS.includes(call.method));
  api.callsTo = (method) => api.calls.filter((call) => call.method === method);
  return api;
}

function runService(config, { sentry, options = {}, serviceData = {}, brandRoot } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: brandRoot || makeBrandRoot(WRITEBACK_CONFIG),
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: Object.keys(config.targets || {}), apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.sentry,
    options,
    serviceData,
    sentryApi: sentry,
  });
}

// ─── Registry / skip semantics ───────────────────────────────────────────────

test('sentry: registered between adsense and sendgrid with the two operations', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('adsense') + 1], 'sentry');
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('sentry') + 1], 'sendgrid');
  assert.deepEqual(OPERATIONS.sentry.map((op) => op.name), ['projects', 'dsn']);
});

test('sentry: skips without a monitoring section, when disabled, and on another provider', async () => {
  const none = await runService(brandConfig({ monitoring: null }), { sentry: fakeSentry() });
  assert.equal(none.status, 'skipped');
  assert.match(none.reason, /no monitoring config/);

  const disabled = await runService(brandConfig({ monitoring: false }), { sentry: fakeSentry() });
  assert.equal(disabled.status, 'skipped');
  assert.match(disabled.reason, /disabled/);

  const other = await runService(brandConfig({ monitoring: { provider: 'other' } }), { sentry: fakeSentry() });
  assert.equal(other.status, 'skipped');
  assert.match(other.reason, /other/);
});

test('sentry: skips without SENTRY_AUTH_TOKEN in .env (machine-readable missingEnv)', async () => {
  const result = await runService(brandConfig()); // no injected api → the creds check applies
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /SENTRY_AUTH_TOKEN/);
  assert.deepEqual(result.missingEnv, ['SENTRY_AUTH_TOKEN']);
});

// ─── Create-on-missing ───────────────────────────────────────────────────────

test('sentry: empty org — team + one project per target created, org and DSNs written back', async () => {
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const api = fakeSentry({
    getOrganizations: [ORG],
    getTeams: [],
    createTeam: { slug: 'fixture-brand' },
    getProjects: [],
    createProject: (org, team, { slug }) => ({ id: `proj-${slug}`, slug }),
    getProjectKeys: (org, slug) => keysFor(slug.replace('fixture-brand-', '')),
  });

  const result = await runService(brandConfig(), { sentry: api, brandRoot });

  assert.equal(result.status, 'success');
  assert.equal(result.output.projects.created, 4);
  assert.equal(result.output.dsn.landed, 4);
  assert.equal(result.state.org, 'fixture-org');
  assert.equal(result.state.projectMap.backend.slug, 'fixture-brand-backend');

  // Region repoint from the org record
  assert.deepEqual(api.regionUrls, ['https://us.sentry.io']);

  // One team ensure, then a create per target with the right platform
  assert.equal(api.callsTo('createTeam').length, 1);
  const createdPlatforms = Object.fromEntries(
    api.callsTo('createProject').map(({ args }) => [args[2].slug.replace('fixture-brand-', ''), args[2].platform]),
  );
  assert.deepEqual(createdPlatforms, PLATFORMS);

  // omega.json5 gained the org + all four per-target DSNs, comments intact
  const written = readConfigSource(brandRoot);
  assert.match(written, /org: "fixture-org"/);
  for (const target of Object.keys(ALL_TARGETS)) {
    assert.ok(written.includes(dsnOf(target)), `expected ${target} DSN in omega.json5`);
  }
  assert.match(written, /\/\/ stays single-quoted/);
});

test('sentry: only enabled targets get projects', async () => {
  const api = fakeSentry({
    getOrganizations: [ORG],
    getTeams: [{ slug: 'fixture-brand' }],
    getProjects: [],
    createProject: (org, team, { slug }) => ({ id: `proj-${slug}`, slug }),
    getProjectKeys: keysFor('web'),
  });

  const result = await runService(brandConfig({ targets: { web: {} } }), { sentry: api });

  assert.equal(result.output.projects.created, 1);
  assert.deepEqual(api.callsTo('createProject').map(({ args }) => args[2].slug), ['fixture-brand-web']);
});

// ─── Convergence ─────────────────────────────────────────────────────────────

test('sentry: a fully converged brand is a zero-mutation no-op and the file stays byte-identical', async () => {
  const configured = `// Converged fixture
{
  brand: { id: 'fixture-brand' },
  monitoring: { provider: "sentry", org: "fixture-org" },
  targets: {
    web: { monitoring: { dsn: "${dsnOf('web')}" } },
  },
}
`;
  const brandRoot = makeBrandRoot(configured);
  const config = brandConfig({
    monitoring: { provider: 'sentry', org: 'fixture-org' },
    targets: { web: { monitoring: { dsn: dsnOf('web') } } },
  });
  const api = fakeSentry({
    getOrganizations: [ORG],
    getProjects: [projectRecord('web')],
    getProjectKeys: keysFor('web'),
  });

  const result = await runService(config, { sentry: api, brandRoot });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.equal(result.output.projects.synced, 1);
  assert.equal(result.output.dsn.landed, 0);
  assert.equal(readConfigSource(brandRoot), configured);
});

test('sentry: a hand-set stale DSN is drift and gets patched', async () => {
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const config = brandConfig({
    monitoring: { provider: 'sentry', org: 'fixture-org' },
    targets: { web: { monitoring: { dsn: 'https://stale@old.ingest.sentry.io/1' } } },
  });
  const api = fakeSentry({
    getOrganizations: [ORG],
    getProjects: [projectRecord('web')],
    getProjectKeys: keysFor('web'),
  });

  const result = await runService(config, { sentry: api, brandRoot });

  assert.equal(result.output.dsn.landed, 1);
  assert.deepEqual(api.mutations(), []);
  assert.ok(readConfigSource(brandRoot).includes(dsnOf('web')));
});

// ─── Org resolution ──────────────────────────────────────────────────────────

test('sentry: multiple orgs without monitoring.org warns and mutates nothing', async () => {
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const api = fakeSentry({
    getOrganizations: [{ slug: 'org-a' }, { slug: 'org-b' }],
  });

  const result = await runService(brandConfig(), { sentry: api, brandRoot });

  assert.equal(result.status, 'warned');
  assert.equal(result.output.projects.orgUnresolved, true);
  assert.deepEqual(api.mutations(), []);
  assert.equal(readConfigSource(brandRoot), WRITEBACK_CONFIG);
});

test('sentry: a configured org the token cannot see warns honestly', async () => {
  const config = brandConfig({ monitoring: { provider: 'sentry', org: 'someone-elses-org' } });
  const api = fakeSentry({ getOrganizations: [ORG] });

  const result = await runService(config, { sentry: api });

  assert.equal(result.status, 'warned');
  assert.deepEqual(api.mutations(), []);
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('sentry: dry run on an empty org plans everything and mutates nothing', async () => {
  const brandRoot = makeBrandRoot(WRITEBACK_CONFIG);
  const api = fakeSentry({
    getOrganizations: [ORG],
    getProjects: [],
  });

  const result = await runService(brandConfig(), { sentry: api, brandRoot, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.projects.planned, [
    'fixture-brand-web', 'fixture-brand-backend', 'fixture-brand-desktop', 'fixture-brand-extension',
  ]);
  assert.deepEqual(api.mutations(), []);
  assert.equal(readConfigSource(brandRoot), WRITEBACK_CONFIG);
});
