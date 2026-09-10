/**
 * Repo service tests — the org/repo/pages reconciliation against a
 * recording fake API (the real client shells out to gh; these prove the
 * diff-then-patch logic, skip semantics, dry-run zero-mutation guarantee,
 * and the converged-brand no-op).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { OPERATIONS } = require('../src/config.js');
const service = require('../src/services/repo/index.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MUTATING_CALLS = new Set([
  'updateOrg', 'createRepo', 'updateRepo', 'enablePages', 'updatePages', 'setPagesDomain',
]);

function brandConfig(github = {}, extra = {}) {
  return {
    brand: {
      id: 'fixture-brand',
      name: 'Fixture Brand',
      url: 'https://fixture-brand.test',
      description: 'A fixture brand',
    },
    repo: { providers: { github: { shared: false, private: true, org: 'fixture-org', ...github } } },
    targets: { web: {} },
    ...extra,
  };
}

// Org profile with zero drift against brandConfig()
const ORG_OK = {
  name: 'Fixture Brand',
  email: 'support@fixture-brand.test',
  billing_email: 'support@fixture-brand.test',
  description: 'A fixture brand',
  blog: 'https://fixture-brand.test',
  location: 'Anywhere',
};

// Repo with zero drift
const REPO_OK = {
  private: true,
  homepage: 'https://fixture-brand.test',
  html_url: 'https://github.com/fixture-org/fixture-brand-omega',
};

// Pages fully configured
const PAGES_OK = { source: { branch: 'gh-pages' }, cname: 'fixture-brand.test' };

/**
 * Recording fake GitHubAPI — `data` sets what reads return; every call is
 * recorded in `calls` as { name, args }.
 */
function fakeApi(data = {}) {
  const api = { calls: [] };
  const record = (name, ret) => (...args) => {
    api.calls.push({ name, args });
    return ret;
  };

  api.getOrg = record('getOrg', data.org ?? null);
  api.updateOrg = record('updateOrg', {});
  api.getRepo = record('getRepo', data.repo ?? null);
  api.createRepo = (...args) => {
    api.calls.push({ name: 'createRepo', args });
    return { full_name: `${args[0]}/${args[1]}`, html_url: `https://github.com/${args[0]}/${args[1]}` };
  };
  api.updateRepo = record('updateRepo', {});
  api.branchExists = record('branchExists', data.branch ?? false);
  api.getPages = record('getPages', data.pages ?? null);
  api.enablePages = record('enablePages', {});
  api.updatePages = record('updatePages', {});
  api.setPagesDomain = record('setPagesDomain', {});

  api.names = () => api.calls.map((c) => c.name);
  api.mutations = () => api.calls.filter((c) => MUTATING_CALLS.has(c.name));
  api.call = (name) => api.calls.find((c) => c.name === name);
  return api;
}

function run(config, api, options = {}) {
  const targets = Object.keys(config.targets || {});
  return service.run({
    brandId: config.brand?.id || 'fixture-brand',
    brandRoot: '/tmp/fixture-brand',
    brandConfig: config,
    brand: { id: config.brand?.id, config, enabledTargets: targets, targets: [] },
    targets: [],
    operations: OPERATIONS.repo,
    options,
    serviceData: {},
    githubApi: api,
  });
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('repo service: skips without repo.providers.github.org', async () => {
  const config = brandConfig();
  delete config.repo.providers.github.org;

  const result = await run(config, fakeApi());
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /github\.org/);
});

test('repo service: repo.providers.github.enabled = false skips the service', async () => {
  const result = await run(brandConfig({ enabled: false }), fakeApi());
  assert.equal(result.status, 'skipped');
});

test('repo service: shared org skips org reconciliation but still reconciles the repo', async () => {
  const api = fakeApi({ repo: REPO_OK, branch: true, pages: PAGES_OK });
  const result = await run(brandConfig({ shared: true }), api);

  assert.equal(result.status, 'success');
  assert.ok(!api.names().includes('getOrg'));
  assert.ok(api.names().includes('getRepo'));
});

// ─── Idempotency: the converged brand ────────────────────────────────────────

test('repo service: fully converged brand is a zero-mutation no-op with state intact', async () => {
  const api = fakeApi({ org: ORG_OK, repo: REPO_OK, branch: true, pages: PAGES_OK });
  const result = await run(brandConfig(), api);

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.equal(result.state.repo.fullName, 'fixture-org/fixture-brand-omega');
  assert.equal(result.state.pages.domain, 'fixture-brand.test');
});

// ─── Org reconciliation ──────────────────────────────────────────────────────

test('org: drift patches exactly the drifted fields', async () => {
  const api = fakeApi({
    org: { ...ORG_OK, email: 'old@example.com', description: 'Old description' },
    repo: REPO_OK, branch: true, pages: PAGES_OK,
  });
  const result = await run(brandConfig(), api);

  assert.equal(result.status, 'success');
  const update = api.call('updateOrg');
  assert.deepEqual(update.args, ['fixture-org', {
    email: 'support@fixture-brand.test',
    description: 'A fixture brand',
  }]);
  assert.deepEqual(result.output.org.updated, ['email', 'description']);
});

test('org: description over 160 chars is truncated with an ellipsis', async () => {
  const long = 'x'.repeat(200);
  const api = fakeApi({ org: ORG_OK, repo: REPO_OK, branch: true, pages: PAGES_OK });
  const config = brandConfig();
  config.brand.description = long;

  await run(config, api);

  const sent = api.call('updateOrg').args[1].description;
  assert.equal(sent.length, 160);
  assert.ok(sent.endsWith('...'));
});

test('org: location only reconciled when github.location is configured', async () => {
  // Not configured → org location "Anywhere" is left alone (no update at all)
  const untouched = fakeApi({ org: ORG_OK, repo: REPO_OK, branch: true, pages: PAGES_OK });
  await run(brandConfig(), untouched);
  assert.ok(!untouched.names().includes('updateOrg'));

  // Configured → drift is patched
  const patched = fakeApi({ org: ORG_OK, repo: REPO_OK, branch: true, pages: PAGES_OK });
  await run(brandConfig({ location: 'United States of America' }), patched);
  assert.deepEqual(patched.call('updateOrg').args[1], { location: 'United States of America' });
});

test('org: owner that is not an organization is noted, never an error', async () => {
  const api = fakeApi({ org: null, repo: REPO_OK, branch: true, pages: PAGES_OK });
  const result = await run(brandConfig(), api);

  assert.equal(result.status, 'success');
  assert.equal(result.output.org.skipped, 'owner is not an organization');
  assert.ok(!api.names().includes('updateOrg'));
});

// ─── Repo reconciliation ─────────────────────────────────────────────────────

test('repo: missing repo is created with visibility/description/homepage and recorded in state', async () => {
  const api = fakeApi({ org: ORG_OK, repo: null, branch: false });
  const result = await run(brandConfig(), api);

  assert.equal(result.status, 'success');
  const created = api.call('createRepo');
  assert.deepEqual(created.args, ['fixture-org', 'fixture-brand-omega', {
    isPrivate: true,
    description: 'A fixture brand',
    homepage: 'https://fixture-brand.test',
  }]);
  assert.equal(result.state.repo.fullName, 'fixture-org/fixture-brand-omega');
  assert.equal(result.output.repo.created, true);
});

test('repo: github.repo overrides the derived `<brand.id>-omega` repo name', async () => {
  const api = fakeApi({ org: ORG_OK, repo: REPO_OK, branch: true, pages: PAGES_OK });
  await run(brandConfig({ repo: 'custom-repo' }), api);

  assert.deepEqual(api.call('getRepo').args, ['fixture-org', 'custom-repo']);
});

test('repo: visibility/homepage drift patches only the drift', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false, homepage: '' },
    branch: true, pages: PAGES_OK,
  });
  const result = await run(brandConfig(), api);

  assert.equal(result.status, 'success');
  assert.deepEqual(api.call('updateRepo').args, ['fixture-org', 'fixture-brand-omega', {
    private: true,
    homepage: 'https://fixture-brand.test',
  }]);
  assert.deepEqual(result.output.repo.updated, ['private', 'homepage']);
});

// ─── Pages ───────────────────────────────────────────────────────────────────

test('pages: no web target → no Pages API traffic', async () => {
  const api = fakeApi({ org: ORG_OK, repo: REPO_OK });
  const result = await run(brandConfig({}, { targets: { backend: {} } }), api);

  assert.equal(result.status, 'success');
  assert.equal(result.output.pages.skipped, 'no web target');
  assert.ok(!api.names().includes('branchExists'));
});

test('pages: missing gh-pages branch is deploy-first guidance, not an error', async () => {
  const api = fakeApi({ org: ORG_OK, repo: REPO_OK, branch: false });
  const result = await run(brandConfig(), api);

  assert.equal(result.status, 'success');
  assert.equal(result.output.pages.skipped, 'no gh-pages branch');
  assert.ok(!api.names().includes('enablePages'));
});

test('pages: enables + sets domain when unconfigured; fixes a drifted source branch without touching a matching cname', async () => {
  // Unconfigured: enable + domain
  const fresh = fakeApi({ org: ORG_OK, repo: REPO_OK, branch: true, pages: null });
  const result = await run(brandConfig(), fresh);
  assert.equal(result.status, 'success');
  assert.ok(fresh.names().includes('enablePages'));
  assert.deepEqual(fresh.call('setPagesDomain').args, ['fixture-org', 'fixture-brand-omega', 'fixture-brand.test']);

  // Wrong source branch, correct cname: branch fixed, domain untouched
  const drifted = fakeApi({
    org: ORG_OK, repo: REPO_OK, branch: true,
    pages: { source: { branch: 'master' }, cname: 'fixture-brand.test' },
  });
  await run(brandConfig(), drifted);
  assert.ok(drifted.names().includes('updatePages'));
  assert.ok(!drifted.names().includes('setPagesDomain'));
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('dry-run: full drift performs ZERO mutations and reports the plan', async () => {
  const api = fakeApi({
    org: { ...ORG_OK, email: 'old@example.com' },
    repo: null,
    branch: true,
    pages: null,
  });
  const result = await run(brandConfig(), api, { dryRun: true });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.deepEqual(result.output.org.planned, ['email']);
  assert.equal(result.output.repo.planned, 'create');
  assert.deepEqual(result.output.pages.planned, ['enable', 'domain']);
});
