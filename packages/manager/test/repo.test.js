/**
 * Repo service tests — the org/repo/pages/runners reconciliation against a
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
  api.getUser = record('getUser', data.user ?? { type: 'Organization' });
  api.getRunnerGroups = (...args) => {
    api.calls.push({ name: 'getRunnerGroups', args });
    if (data.runnerGroupsError) {
      throw new Error(data.runnerGroupsError);
    }
    return data.runnerGroups ?? { runner_groups: [] };
  };
  api.getRunnerGroupRepositories = (...args) => {
    api.calls.push({ name: 'getRunnerGroupRepositories', args });
    if (data.runnerGroupRepositoriesError) {
      throw new Error(data.runnerGroupRepositoriesError);
    }
    return data.runnerGroupRepositories ?? { repositories: [] };
  };
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

test('repo: a gh-pages default branch is patched back to main when main exists', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, default_branch: 'gh-pages' },
    branch: true, pages: PAGES_OK,
  });
  const result = await run(brandConfig(), api);

  assert.equal(result.status, 'success');
  assert.deepEqual(api.call('updateRepo').args, ['fixture-org', 'fixture-brand-omega', {
    default_branch: 'main',
  }]);
  assert.deepEqual(result.output.repo.updated, ['default_branch']);
});

test('repo: a gh-pages default branch with no main branch is left alone', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, default_branch: 'gh-pages' },
    branch: false, pages: PAGES_OK,
  });
  const result = await run(brandConfig(), api);

  assert.equal(result.status, 'success');
  assert.ok(!api.names().includes('updateRepo'));
});

test('repo: a main default branch asks nothing about branches', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, default_branch: 'main' },
    branch: true, pages: PAGES_OK,
  });
  await run(brandConfig(), api);

  assert.ok(!api.names().includes('updateRepo'));
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

// ─── Runners (#872) ──────────────────────────────────────────────────────────

// A public brand repo whose desktop target signs Windows on the org's
// self-hosted EV-token runner
function desktopBrand(desktop = {}) {
  return brandConfig({ private: false }, { targets: { web: {}, desktop: desktop } });
}

const RUNNERS_LINK = 'https://github.com/organizations/fixture-org/settings/actions/runner-groups';

test('runners: an org group that allows public repositories passes', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    runnerGroups: { runner_groups: [{ id: 1, name: 'Default', allows_public_repositories: true, visibility: 'all' }] },
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'success');
  assert.deepEqual(api.call('getRunnerGroups').args, ['fixture-org']);
  assert.equal(result.output.runners.group, 'Default');
  // visibility 'all' already answers for every repo: nothing deeper to read
  assert.ok(!api.names().includes('getRunnerGroupRepositories'));
});

test('runners: a selected-repositories group that lists the brand repo passes (#879)', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    runnerGroups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
    runnerGroupRepositories: { repositories: [{ name: 'fixture-brand-omega', full_name: 'fixture-org/fixture-brand-omega' }] },
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'success');
  assert.deepEqual(api.call('getRunnerGroupRepositories').args, ['fixture-org', 7]);
  assert.equal(result.output.runners.group, 'Signers');
});

test('runners: a selected-repositories group without the brand repo FAILS the walk (#879)', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    runnerGroups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
    runnerGroupRepositories: { repositories: [{ name: 'other-omega', full_name: 'fixture-org/other-omega' }] },
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'error');
  assert.match(result.error, /Signers/);
  assert.match(result.error, /fixture-org\/fixture-brand-omega/);
  assert.ok(result.error.includes(RUNNERS_LINK));
  assert.deepEqual(result.failed, [{ operation: 'runners', reason: result.error }]);
});

test('runners: a later allowing group serves the repo when an earlier selected group leaves it out (#879)', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    runnerGroups: {
      runner_groups: [
        { id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' },
        { id: 2, name: 'Default', allows_public_repositories: true, visibility: 'all' },
      ],
    },
    runnerGroupRepositories: { repositories: [] },
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'success');
  assert.equal(result.output.runners.group, 'Default');
  // The scoped group is read once, then the walk moves on to the next group
  assert.deepEqual(api.call('getRunnerGroupRepositories').args, ['fixture-org', 7]);
  assert.equal(api.names().filter((name) => name === 'getRunnerGroupRepositories').length, 1);
});

test('runners: a token without the scope to read a group\'s repositories warns with the link (#879)', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    runnerGroups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
    runnerGroupRepositoriesError: 'gh command failed: HTTP 403: Resource not accessible by integration',
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'warned');
  assert.equal(result.warned.length, 1);
  assert.equal(result.warned[0].operation, 'runners');
  assert.ok(result.output.runners.unreadable.includes(RUNNERS_LINK));
});

test('runners: a repositories read that fails for any other reason is an error, never "check it by hand" (#879)', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    runnerGroups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
    runnerGroupRepositoriesError: 'gh command failed: HTTP 500: Internal Server Error',
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'error');
  assert.match(result.error, /HTTP 500/);
});

test('runners: no group allowing public repositories FAILS the walk, naming the checkbox and the link', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    runnerGroups: { runner_groups: [{ name: 'Default', allows_public_repositories: false }] },
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'error');
  assert.match(result.error, /Allow public repositories/);
  assert.ok(result.error.includes(RUNNERS_LINK));
  assert.deepEqual(result.failed, [{ operation: 'runners', reason: result.error }]);
});

test('runners: a personal-account owner has no runner groups to read', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    user: { type: 'User' },
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'success');
  assert.equal(result.output.runners.skipped, 'owner is not an organization');
  assert.ok(!api.names().includes('getRunnerGroups'));
});

test('runners: a token without the scope to read the groups warns with the link', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    runnerGroupsError: 'gh command failed: HTTP 403: Resource not accessible by integration',
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'warned');
  assert.equal(result.warned.length, 1);
  assert.equal(result.warned[0].operation, 'runners');
  assert.ok(result.output.runners.unreadable.includes(RUNNERS_LINK));
});

test('runners: a read that fails for any other reason is an error, never "check it by hand"', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
    runnerGroupsError: 'gh command failed: HTTP 500: Internal Server Error',
  });
  const result = await run(desktopBrand(), api);

  assert.equal(result.status, 'error');
  assert.match(result.error, /HTTP 500/);
});

test('runners: a cloud Windows signer never touches the org runner groups', async () => {
  const api = fakeApi({
    org: ORG_OK,
    repo: { ...REPO_OK, private: false },
    branch: true, pages: PAGES_OK,
  });
  const result = await run(desktopBrand({ platforms: { win: { signing: { strategy: 'cloud' } } } }), api);

  assert.equal(result.status, 'success');
  assert.equal(result.output.runners.skipped, 'Windows signing strategy is cloud');
  assert.ok(!api.names().includes('getRunnerGroups'));
});

test('runners: a private repo and a brand with no desktop target both skip', async () => {
  const priv = fakeApi({ org: ORG_OK, repo: REPO_OK, branch: true, pages: PAGES_OK });
  const privResult = await run(brandConfig({}, { targets: { web: {}, desktop: {} } }), priv);
  assert.equal(privResult.status, 'success');
  assert.equal(privResult.output.runners.skipped, 'repo is private');

  const noDesktop = fakeApi({ org: ORG_OK, repo: { ...REPO_OK, private: false }, branch: true, pages: PAGES_OK });
  const noDesktopResult = await run(brandConfig({ private: false }), noDesktop);
  assert.equal(noDesktopResult.status, 'success');
  assert.equal(noDesktopResult.output.runners.skipped, 'no desktop target');
  assert.ok(!noDesktop.names().includes('getUser'));
});
