/**
 * Repo service tests (#883): the two roles the walk owns, against the REAL
 * @omega.js/devkit github-repo module driven by a fake `gh` exec.
 *
 * Nothing about the repo shapes is mocked (the plans, the idempotency and the
 * argv are devkit's own), so what these prove is the manager's half: which
 * repo each role addresses, what visibility it asks for and why, that Pages is
 * configured on the WEBSITE repo and never on the source one, and that a dry
 * run issues no mutating gh call at all.
 *
 * The three org-Actions reads the runner check makes are the exception: they
 * are plain GET reads whose ANSWERS are the whole point of that step, so they
 * come from stubs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const devkit = require('@omega.js/devkit/github-repo');
const { OPERATIONS } = require('../src/config.js');
const service = require('../src/services/repo/index.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SOURCE = 'fixture-org/fixture-brand-omega';
const WEBSITE = 'fixture-org/fixture-brand-web';

function brandConfig(extra = {}) {
  return {
    brand: {
      id: 'fixture-brand',
      name: 'Fixture Brand',
      url: 'https://fixture-brand.test',
      description: 'A fixture brand',
    },
    repo: { provider: 'github', org: 'fixture-org' },
    targets: { web: { type: 'web' } },
    ...extra,
  };
}

/**
 * A brand root on disk: the ONE statement of visibility is its package.json
 * `private` field, so the service reads a real file like a real walk does.
 *
 * @param {boolean} [isPrivate] - The `private` field; omitted writes no key.
 * @returns {string} The brand root.
 */
function brandRoot(isPrivate) {
  const root = jetpack.tmpDir({ prefix: 'omega-repo-' }).cwd();
  jetpack.write(path.join(root, 'package.json'), {
    name: 'fixture-brand',
    ...(isPrivate === undefined ? {} : { private: isPrivate }),
  });
  return root;
}

/**
 * A fake `gh` exec: every call is recorded as its argv, and the reads answer
 * from a small world of repos, branches, pages and one org plan.
 *
 * @param {object} [world]
 * @param {object} [world.repos] - slug -> repo json (absent = a 404).
 * @param {object} [world.pages] - slug -> pages json (absent = Pages off).
 * @param {object} [world.branches] - slug -> branch names that exist.
 * @param {string} [world.plan] - The org's plan name (default free).
 * @param {boolean} [world.userOwner] - The owner is a user: `orgs/<owner>` 404s.
 * @returns {function} An execFn for devkit's gh(), carrying `.calls`.
 */
function fakeGh(world = {}) {
  const repos = world.repos || {};
  const pages = world.pages || {};
  const branches = world.branches || {};

  const notFound = () => {
    const error = new Error('HTTP 404: Not Found');
    error.stderr = 'gh: Not Found (HTTP 404)';
    throw error;
  };

  const execFn = (file, args) => {
    execFn.calls.push(args);

    if (args[0] === 'repo' && args[1] === 'create') return '';
    if (args[0] !== 'api') return '';

    const endpoint = args[1];
    const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
    const org = /^orgs\/([^/]+)$/.exec(endpoint);
    const repo = /^repos\/([^/]+\/[^/]+)$/.exec(endpoint);
    const branch = /^repos\/([^/]+\/[^/]+)\/branches\/(.+)$/.exec(endpoint);
    const page = /^repos\/([^/]+\/[^/]+)\/pages$/.exec(endpoint);

    if (org) {
      if (world.userOwner) return notFound();
      return JSON.stringify({ plan: { name: world.plan || 'free' } });
    }
    if (repo) {
      if (method !== 'GET') return '{}';
      return repos[repo[1]] ? JSON.stringify(repos[repo[1]]) : notFound();
    }
    if (branch) {
      return (branches[branch[1]] || []).includes(branch[2]) ? JSON.stringify({ name: branch[2] }) : notFound();
    }
    if (page) {
      if (method !== 'GET') return '{}';
      return pages[page[1]] ? JSON.stringify(pages[page[1]]) : notFound();
    }

    return '{}';
  };

  execFn.calls = [];
  return execFn;
}

/**
 * Every gh call that WRITES: a dry run must issue none of them.
 * @param {function} execFn - From fakeGh().
 * @returns {Array<string[]>} The mutating argvs.
 */
function mutations(execFn) {
  return execFn.calls.filter((args) => (
    (args[0] === 'repo' && args[1] === 'create')
    || args.includes('-X')
  ));
}

/**
 * The gh api endpoints the run touched, in order.
 * @param {function} execFn - From fakeGh().
 * @returns {string[]} The endpoints.
 */
function endpoints(execFn) {
  return execFn.calls.filter((args) => args[0] === 'api').map((args) => args[1]);
}

/**
 * The service's GitHub client: devkit's real functions bound to the fake exec,
 * plus stubs for the three org-Actions reads.
 *
 * @param {function} execFn - From fakeGh().
 * @param {object} [runners] - { user, groups, groupsError, repositories, repositoriesError }.
 * @returns {object} The client shape src/services/repo/lib/github.js builds.
 */
function client(execFn, runners = {}) {
  const api = {
    getRepo: (owner, name) => devkit.getRepo(owner, name, { execFn }),
    ensureRepo: (repo, options = {}) => devkit.ensureRepo(repo, { ...options, execFn }),
    getPages: (owner, name) => devkit.getPages(owner, name, { execFn }),
    ensurePages: (pages, options = {}) => devkit.ensurePages(pages, { ...options, execFn, logger: { log: () => {} } }),
    ownerPlan: (owner) => {
      api.planReads += 1;
      return devkit.ownerPlan(owner, { execFn });
    },
    planReads: 0,
    getUser: () => runners.user ?? { type: 'Organization' },
    getRunnerGroups: () => {
      if (runners.groupsError) throw new Error(runners.groupsError);
      return runners.groups ?? { runner_groups: [] };
    },
    getRunnerGroupRepositories: (org, id) => {
      api.groupReads.push([org, id]);
      if (runners.repositoriesError) throw new Error(runners.repositoriesError);
      return runners.repositories ?? { repositories: [] };
    },
    groupReads: [],
  };

  return api;
}

function run(config, api, { root, options = {} } = {}) {
  return service.run({
    brandId: config.brand?.id || 'fixture-brand',
    brandRoot: root || brandRoot(true),
    brandConfig: config,
    brand: { id: config.brand?.id, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.repo,
    options,
    serviceData: {},
    githubApi: api,
  });
}

/**
 * The converged world: both repos exist as configured, gh-pages is pushed and
 * Pages serves the site from it.
 * @returns {object} A fakeGh world.
 */
function convergedWorld() {
  return {
    repos: {
      [SOURCE]: { private: true, homepage: '' },
      [WEBSITE]: { private: false, homepage: 'https://fixture-brand.test' },
    },
    branches: { [WEBSITE]: ['gh-pages'] },
    pages: { [WEBSITE]: { source: { branch: 'gh-pages' }, cname: 'fixture-brand.test' } },
  };
}

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('repo service: a config with no repo block skips, naming repo.org', async () => {
  const config = brandConfig();
  delete config.repo;

  const result = await run(config, client(fakeGh()));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /repo\.org/);
});

test('repo service: an org with no brand.id fails loudly instead of ensuring half an address', async () => {
  const config = brandConfig();
  delete config.brand.id;

  await assert.rejects(() => run(config, client(fakeGh())), /brand\.id/);
});

test('repo service: the operations are the two roles, the runner check, then the secrets push', () => {
  // `secrets` is LAST (#891): it publishes into the repos the roles above make.
  assert.deepEqual(OPERATIONS.repo.map((op) => op.name), ['repo', 'website', 'runners', 'secrets']);
});

// ─── The plan (dry run) ──────────────────────────────────────────────────────

test('dry run: the plan names the private source repo and the public website repo, and mutates nothing', async () => {
  const execFn = fakeGh();
  const result = await run(brandConfig(), client(execFn), { options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(mutations(execFn), []);

  assert.deepEqual(result.output.repo.planned, [`create ${SOURCE} (private)`]);
  assert.deepEqual(result.output.website.planned, [`create ${WEBSITE} (public: free plan)`]);
  assert.equal(result.output.website.repos[0].visibility, 'public');
});

test('dry run: a private brand on a PAID org plans a private website repo, saying which plan', async () => {
  const execFn = fakeGh({ plan: 'team' });
  const result = await run(brandConfig(), client(execFn), { options: { dryRun: true } });

  assert.deepEqual(result.output.website.planned, [`create ${WEBSITE} (private: fixture-org is on the team plan)`]);
  assert.equal(result.output.website.repos[0].visibility, 'private');
});

test('dry run: a PUBLIC brand publishes both repos, the plan never asked about', async () => {
  const execFn = fakeGh();
  const api = client(execFn);
  const result = await run(brandConfig(), api, { root: brandRoot(false), options: { dryRun: true } });

  assert.deepEqual(result.output.repo.planned, [`create ${SOURCE} (public)`]);
  assert.deepEqual(result.output.website.planned, [`create ${WEBSITE} (public: the brand is public)`]);
  assert.equal(api.planReads, 0, 'a public brand needs no plan to know the answer');
});

test('visibility: a brand root with no `private` key at all is private (#883)', async () => {
  const execFn = fakeGh();
  const result = await run(brandConfig(), client(execFn), { root: brandRoot(undefined), options: { dryRun: true } });

  assert.deepEqual(result.output.repo.planned, [`create ${SOURCE} (private)`]);
});

// ─── The source role ─────────────────────────────────────────────────────────

test('source: the repo is created private, with no homepage and no initial commit', async () => {
  const execFn = fakeGh();
  const result = await run(brandConfig(), client(execFn));

  assert.equal(result.output.repo.created, true);
  const create = execFn.calls.find((args) => args[0] === 'repo' && args[1] === 'create');
  assert.deepEqual(create, ['repo', 'create', SOURCE, '--private', '--description', 'A fixture brand']);
  assert.equal(result.state.repo.fullName, SOURCE);
});

test('source: visibility drift is patched back to what the brand root states', async () => {
  const world = convergedWorld();
  world.repos[SOURCE] = { private: false, homepage: '' };
  const execFn = fakeGh(world);

  const result = await run(brandConfig(), client(execFn));

  assert.equal(result.output.repo.changed, true);
  assert.deepEqual(result.output.repo.planned, [`${SOURCE}: public -> private`]);
  const patch = execFn.calls.find((args) => args.includes('-X') && args[1] === `repos/${SOURCE}`);
  assert.deepEqual(patch, ['api', `repos/${SOURCE}`, '-X', 'PATCH', '-F', 'private=true']);
});

test('source: Pages still serving the source repo is a warning with the by-hand steps, never a delete', async () => {
  const world = convergedWorld();
  world.pages[SOURCE] = { source: { branch: 'gh-pages' }, cname: 'fixture-brand.test' };
  const execFn = fakeGh(world);

  const result = await run(brandConfig(), client(execFn));

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.warned, [{ operation: 'repo', reason: `${SOURCE} still serves GitHub Pages: the website moved to its own repo (#883)` }]);
  assert.deepEqual(mutations(execFn), [], 'the walk never retires Pages on its own');
});

test('source: Pages is never CONFIGURED on the source repo, converged or fresh', async () => {
  const converged = fakeGh(convergedWorld());
  await run(brandConfig(), client(converged));

  const fresh = fakeGh();
  await run(brandConfig(), client(fresh));

  for (const execFn of [converged, fresh]) {
    const sourcePages = execFn.calls.filter((args) => args[1] === `repos/${SOURCE}/pages` && args.includes('-X'));
    assert.deepEqual(sourcePages, []);
  }
});

// ─── The website role ────────────────────────────────────────────────────────

test('website: a fresh repo is created public with the target url, and Pages waits for the first deploy', async () => {
  const execFn = fakeGh();
  const result = await run(brandConfig(), client(execFn));

  const create = execFn.calls.find((args) => args[0] === 'repo' && args[1] === 'create' && args[2] === WEBSITE);
  assert.deepEqual(create, [
    'repo', 'create', WEBSITE, '--public',
    '--description', 'Fixture Brand website (web)',
    '--homepage', 'https://fixture-brand.test',
  ]);
  assert.ok(!create.includes('--add-readme'), 'a repo the deploy force-pushes never starts with a commit');

  assert.equal(result.output.website.repos[0].pagesPending, true);
  assert.deepEqual(endpoints(execFn).filter((endpoint) => endpoint === `repos/${WEBSITE}/pages`), []);
});

test('website: once gh-pages exists, Pages is pointed at it and at the target host', async () => {
  const execFn = fakeGh({
    repos: { [SOURCE]: { private: true }, [WEBSITE]: { private: false, homepage: 'https://fixture-brand.test' } },
    branches: { [WEBSITE]: ['gh-pages'] },
  });
  const result = await run(brandConfig(), client(execFn));

  assert.deepEqual(result.output.website.planned, [`pages ${WEBSITE}: gh-pages -> fixture-brand.test`]);
  const post = execFn.calls.find((args) => args[1] === `repos/${WEBSITE}/pages` && args.includes('POST'));
  assert.deepEqual(post, ['api', `repos/${WEBSITE}/pages`, '-X', 'POST', '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/']);
  const domain = execFn.calls.find((args) => args[1] === `repos/${WEBSITE}/pages` && args.includes('PUT'));
  assert.deepEqual(domain, ['api', `repos/${WEBSITE}/pages`, '-X', 'PUT', '-f', 'cname=fixture-brand.test']);
});

test('website: two web targets get two repos, one per NAME, off ONE plan read', async () => {
  const config = brandConfig({ targets: { web: { type: 'web' }, community: { type: 'web' } } });
  const execFn = fakeGh();
  const api = client(execFn);

  const result = await run(config, api, { options: { dryRun: true } });

  assert.deepEqual(result.output.website.repos.map((repo) => repo.slug), [
    WEBSITE,
    'fixture-org/fixture-brand-community',
  ]);
  assert.equal(api.planReads, 1, 'the plan is the org\'s, not the target\'s');
  assert.match(result.output.website.planned.join('\n'), /create fixture-org\/fixture-brand-community \(public: free plan\)/);
});

test('website: the second target\'s Pages domain is its OWN subdomain', async () => {
  const config = brandConfig({ targets: { web: { type: 'web' }, community: { type: 'web' } } });
  const execFn = fakeGh({
    repos: {
      [SOURCE]: { private: true },
      [WEBSITE]: { private: false, homepage: 'https://fixture-brand.test' },
      'fixture-org/fixture-brand-community': { private: false, homepage: 'https://community.fixture-brand.test' },
    },
    branches: { 'fixture-org/fixture-brand-community': ['gh-pages'] },
  });

  await run(config, client(execFn));

  const domain = execFn.calls.find((args) => args[1] === 'repos/fixture-org/fixture-brand-community/pages' && args.includes('PUT'));
  assert.deepEqual(domain, ['api', 'repos/fixture-org/fixture-brand-community/pages', '-X', 'PUT', '-f', 'cname=community.fixture-brand.test']);
});

// C5/#366: a project site's url IS its Pages address, so the walk has no custom
// domain to claim. The derivation is @omega.js/config's ONE `pagesHost`, the
// same one the web deploy writes its CNAME file from: claiming
// `<owner>.github.io` here would take the site off the address it serves at.
test('website: a *.github.io brand claims NO custom domain', async () => {
  const config = brandConfig();
  config.brand.url = 'https://fixture-org.github.io/fixture-brand-web/';
  const execFn = fakeGh({
    repos: { [SOURCE]: { private: true }, [WEBSITE]: { private: false, homepage: 'https://fixture-org.github.io/fixture-brand-web/' } },
    branches: { [WEBSITE]: ['gh-pages'] },
  });

  const result = await run(config, client(execFn));

  assert.deepEqual(result.output.website.planned, [`pages ${WEBSITE}: gh-pages`], 'the branch, and no domain');
  const domain = execFn.calls.find((args) => args[1] === `repos/${WEBSITE}/pages` && args.includes('PUT'));
  assert.equal(domain, undefined, 'no cname is ever PUT for a project site');
});

test('website: a brand with no web target owns no website repo', async () => {
  const execFn = fakeGh();
  const result = await run(brandConfig({ targets: { backend: { type: 'backend' } } }), client(execFn));

  assert.equal(result.output.website.skipped, 'no GitHub-hosted web target');
  assert.deepEqual(endpoints(execFn).filter((endpoint) => endpoint.includes('-web')), []);
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

test('a fully converged brand is a zero-mutation no-op', async () => {
  const execFn = fakeGh(convergedWorld());
  const result = await run(brandConfig(), client(execFn));

  assert.equal(result.status, 'success');
  assert.deepEqual(mutations(execFn), []);
  assert.deepEqual(result.output.website.planned, []);
});

// ─── Runners (#872, #879) ────────────────────────────────────────────────────

const RUNNERS_LINK = 'https://github.com/organizations/fixture-org/settings/actions/runner-groups';

// A brand whose desktop target signs Windows on the org's self-hosted EV-token
// runner. Public unless a case says otherwise: its package.json is the switch.
function desktopBrand(desktop = {}) {
  return brandConfig({ targets: { web: { type: 'web' }, desktop: { type: 'desktop', ...desktop } } });
}

function publicWorld() {
  const world = convergedWorld();
  world.repos[SOURCE] = { private: false, homepage: '' };
  return world;
}

async function runDesktop(runners, { config = desktopBrand(), isPrivate = false, workflows = {} } = {}) {
  const execFn = fakeGh(publicWorld());
  const api = client(execFn, runners);
  const root = brandRoot(isPrivate);

  // The brand's COMPOSED workflows, where GitHub actually runs them: the repo
  // root's `.github/workflows/` (#875).
  for (const [name, content] of Object.entries(workflows)) {
    jetpack.write(path.join(root, '.github', 'workflows', name), content);
  }

  const result = await run(config, api, { root });

  return { result, api, execFn, root };
}

const ALLOWING = { runner_groups: [{ id: 1, name: 'Default', allows_public_repositories: true, visibility: 'all' }] };

/**
 * A workflow file, in the shape the desktop template composes into a brand.
 *
 * @param {string} on - The `on:` block's body, indented two spaces.
 * @param {string} [runsOn] - The sign job's `runs-on:` value.
 * @returns {string} The workflow.
 */
function workflow(on, runsOn = `${'$'}{{ fromJSON('["self-hosted","windows","ev-token"]') }}`) {
  return [
    'name: Build & Release',
    'on:',
    on,
    '',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: npm run package',
    '  windows-sign:',
    `    runs-on: ${runsOn}`,
    '    steps:',
    '      - run: omega sign-windows',
    '',
  ].join('\n');
}

/**
 * Everything the walk printed, so a case can read the warning LINE rather than
 * only the result it rides in on.
 *
 * @param {function} body - The run.
 * @returns {Promise<{result: object, lines: string[]}>} The run's result and output.
 */
async function captureRun(body) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    return { ...(await body()), lines };
  } finally {
    console.log = original;
  }
}

test('runners: an org group that allows public repositories passes', async () => {
  const { result, api } = await runDesktop({
    groups: { runner_groups: [{ id: 1, name: 'Default', allows_public_repositories: true, visibility: 'all' }] },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.output.runners.group, 'Default');
  assert.deepEqual(api.groupReads, [], 'visibility all already answers for every repo');
});

test('runners: a selected-repositories group that lists the SOURCE repo passes (#879)', async () => {
  const { result, api } = await runDesktop({
    groups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
    repositories: { repositories: [{ name: 'fixture-brand-omega', full_name: SOURCE }] },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.groupReads, [['fixture-org', 7]]);
  assert.equal(result.output.runners.group, 'Signers');
});

test('runners: a selected-repositories group without the source repo FAILS the walk (#879)', async () => {
  const { result } = await runDesktop({
    groups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
    repositories: { repositories: [{ name: 'other-omega', full_name: 'fixture-org/other-omega' }] },
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /Signers/);
  assert.ok(result.error.includes(SOURCE));
  assert.ok(result.error.includes(RUNNERS_LINK));
  assert.deepEqual(result.failed, [{ operation: 'runners', reason: result.error }]);
});

test('runners: a later allowing group serves the repo when an earlier selected group leaves it out (#879)', async () => {
  const { result, api } = await runDesktop({
    groups: {
      runner_groups: [
        { id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' },
        { id: 2, name: 'Default', allows_public_repositories: true, visibility: 'all' },
      ],
    },
    repositories: { repositories: [] },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.output.runners.group, 'Default');
  assert.deepEqual(api.groupReads, [['fixture-org', 7]]);
});

test('runners: a token without the scope to read a group\'s repositories warns with the link (#879)', async () => {
  const { result } = await runDesktop({
    groups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
    repositoriesError: 'gh api failed: HTTP 403: Resource not accessible by integration',
  });

  assert.equal(result.status, 'warned');
  assert.equal(result.warned.at(-1).operation, 'runners');
  assert.ok(result.output.runners.unreadable.includes(RUNNERS_LINK));
});

test('runners: a repositories read that fails for any other reason is an error, never "check it by hand" (#879)', async () => {
  const { result } = await runDesktop({
    groups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
    repositoriesError: 'gh api failed: HTTP 500: Internal Server Error',
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /HTTP 500/);
});

test('runners: no group allowing public repositories FAILS the walk, naming the checkbox and the link', async () => {
  const { result } = await runDesktop({
    groups: { runner_groups: [{ name: 'Default', allows_public_repositories: false }] },
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /Allow public repositories/);
  assert.ok(result.error.includes(RUNNERS_LINK));
});

test('runners: a personal-account owner has no runner groups to read', async () => {
  const { result } = await runDesktop({ user: { type: 'User' } });

  assert.equal(result.status, 'success');
  assert.equal(result.output.runners.skipped, 'owner is not an organization');
});

test('runners: a token without the scope to read the groups warns with the link', async () => {
  const { result } = await runDesktop({ groupsError: 'gh api failed: HTTP 403: Resource not accessible by integration' });

  assert.equal(result.status, 'warned');
  assert.ok(result.output.runners.unreadable.includes(RUNNERS_LINK));
});

test('runners: a cloud Windows signer never touches the org runner groups', async () => {
  const { result } = await runDesktop({}, { config: desktopBrand({ platforms: { windows: { signing: { strategy: 'cloud' } } } }) });

  assert.equal(result.status, 'success');
  assert.equal(result.output.runners.skipped, 'Windows signing strategy is cloud');
});

test('runners: the signing strategy is read off the desktop-TYPED entry, whatever it is named (#886)', async () => {
  const config = brandConfig({
    targets: { web: { type: 'web' }, app: { type: 'desktop', platforms: { windows: { signing: { strategy: 'cloud' } } } } },
  });
  const { result } = await runDesktop({}, { config });

  assert.equal(result.output.runners.skipped, 'Windows signing strategy is cloud', 'the entry named `app` is the desktop target');
});

test('runners: a PRIVATE brand and a brand with no desktop target both skip', async () => {
  const priv = await runDesktop({}, { isPrivate: true });
  assert.equal(priv.result.output.runners.skipped, 'repo is private');

  const noDesktop = await runDesktop({}, { config: brandConfig() });
  assert.equal(noDesktop.result.output.runners.skipped, 'no desktop target');
});


// ─── runners: the stray-trigger warning (#875) ───────────────────────────────
// The org runner group says whether a dispatch REACHES the self-hosted signer;
// this says what ELSE could reach it. A workflow with a job on the box fires on
// a dispatch and nothing else, so a `push` or `pull_request` trigger in one is
// warned on by name.

test('runners: a push trigger in a workflow that targets a self-hosted runner warns, naming the file and the trigger (#875)', async () => {
  const { result, lines } = await captureRun(() => runDesktop(
    { groups: ALLOWING },
    { workflows: { 'desktop-build.yml': workflow('  workflow_dispatch:\n  push:\n    branches: [main]') } },
  ));

  assert.equal(result.status, 'warned');
  assert.equal(result.warned.at(-1).operation, 'runners');
  assert.deepEqual(result.output.runners.strayTriggers, [{ file: 'desktop-build.yml', trigger: 'push' }]);
  // The group answer rides along: the two checks never overwrite each other.
  assert.equal(result.output.runners.group, 'Default');

  const warning = lines.find((line) => line.includes('desktop-build.yml') && line.includes('push'));
  assert.ok(warning, 'one line naming the file and the trigger');
  assert.match(warning, /self-hosted/);
});

test('runners: a pull_request trigger is warned on too, and both are named at once (#875)', async () => {
  const { result } = await captureRun(() => runDesktop(
    { groups: ALLOWING },
    { workflows: { 'desktop-build.yml': workflow('  push:\n  pull_request:\n  workflow_dispatch:') } },
  ));

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.runners.strayTriggers, [
    { file: 'desktop-build.yml', trigger: 'push' },
    { file: 'desktop-build.yml', trigger: 'pull_request' },
  ]);
  assert.match(result.warned.at(-1).reason, /desktop-build\.yml \(push\), desktop-build\.yml \(pull_request\)/);
});

test('runners: the dispatch-only workflows a brand actually composes warn about nothing (#875)', async () => {
  const { result } = await captureRun(() => runDesktop(
    { groups: ALLOWING },
    { workflows: { 'desktop-build.yml': workflow('  workflow_dispatch:') } },
  ));

  assert.equal(result.status, 'success');
  assert.equal(result.output.runners.group, 'Default');
  assert.equal(result.output.runners.strayTriggers, undefined);
});

test('runners: a push trigger on a HOSTED-runner workflow is nobody\'s emergency (#875)', async () => {
  const { result } = await captureRun(() => runDesktop(
    { groups: ALLOWING },
    { workflows: { 'web-build.yml': workflow('  push:\n  workflow_dispatch:', 'ubuntu-latest') } },
  ));

  assert.equal(result.status, 'success');
});

test('runners: a trigger with a trailing COMMENT is still a stray trigger (B3)', async () => {
  const { result } = await captureRun(() => runDesktop(
    { groups: ALLOWING },
    { workflows: { 'desktop-build.yml': workflow('  workflow_dispatch:\n  push: # only main, for now') } },
  ));

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.runners.strayTriggers, [{ file: 'desktop-build.yml', trigger: 'push' }]);
});

test('runners: a FLOW-style trigger is still a stray trigger (C7)', async () => {
  const { result } = await captureRun(() => runDesktop(
    { groups: ALLOWING },
    { workflows: { 'desktop-build.yml': workflow('  workflow_dispatch:\n  push: { branches: [main] }') } },
  ));

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.runners.strayTriggers, [{ file: 'desktop-build.yml', trigger: 'push' }]);
});

test('runners: the QUOTED `"on":` key reads like the bare one (C7)', async () => {
  // YAML 1.1 reads a bare `on` as the boolean true, so a quoted key is a
  // spelling a real workflow carries, not a curiosity.
  const quoted = workflow('  workflow_dispatch:\n  push:').replace(/^on:$/m, '"on":');

  const { result } = await captureRun(() => runDesktop(
    { groups: ALLOWING },
    { workflows: { 'desktop-build.yml': quoted } },
  ));

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.runners.strayTriggers, [{ file: 'desktop-build.yml', trigger: 'push' }]);
});

test('runners: a stray trigger never softens the runner-group ERROR it rides with (#875)', async () => {
  const { result } = await captureRun(() => runDesktop(
    { groups: { runner_groups: [{ name: 'Default', allows_public_repositories: false }] } },
    { workflows: { 'desktop-build.yml': workflow('  push:') } },
  ));

  assert.equal(result.status, 'error');
  assert.match(result.error, /Allow public repositories/);
});


// ─── secrets: the manage-lane call of the ONE publisher (#891) ──────────────
// The push is a deploy PRECHECK first, but "it could happen elsewhere like
// manage too" (Ian 2026-09-12), so the walk that owns the brand's repos owns
// this too. The transport is devkit's; what these prove is the framing.

/**
 * A brand root with one target, its .env, and the target entry shape the walk
 * hands every service (lib/brand.js discoverTargets).
 *
 * @param {object} input
 * @param {string} input.target - Target type.
 * @param {string} [input.brandEnv] - The brand .env contents.
 * @param {object} [input.extra] - Extra brand config keys.
 * @returns {{ root: string, targets: object[] }}
 */
function brandWithTarget({ target, brandEnv = '', extra = {} }) {
  const root = jetpack.tmpDir({ prefix: 'omega-repo-secrets-' }).cwd();

  jetpack.write(path.join(root, 'package.json'), { name: 'fixture-brand', private: true, workspaces: ['targets/*'] });
  jetpack.write(path.join(root, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
    repo: { provider: 'github', org: 'fixture-org' },
    targets: { [target]: { type: target } },
    ...extra,
  }));
  jetpack.write(path.join(root, '.env'), brandEnv);

  const targetPath = path.join(root, 'targets', target);
  jetpack.write(path.join(targetPath, 'package.json'), { name: `fixture-brand-${target}`, private: true });

  return { root, targets: [{ name: target, dir: `targets/${target}`, path: targetPath, target }] };
}

// The git boundary, answering per command: a single answer reads as a NESTED
// brand and skips the very guard the publisher applies.
const gitStub = (root) => (command) => (command.includes('--show-toplevel') ? `${root}\n` : 'git@github.com:fixture-org/fixture-brand-omega.git\n');

test('secrets: a dry run plans the target\'s key NAMES and issues no gh call', async () => {
  const { root, targets } = brandWithTarget({ target: 'extension', brandEnv: 'CHROME_CLIENT_ID=client-id\n' });
  const execFn = fakeGh(convergedWorld());
  const ghCalls = [];

  const result = await service.run({
    brandId: 'fixture-brand',
    brandRoot: root,
    brandConfig: brandConfig(),
    brand: { id: 'fixture-brand', config: brandConfig(), enabledTargets: ['web'], targets: [] },
    targets,
    operations: OPERATIONS.repo,
    options: { dryRun: true },
    serviceData: {},
    githubApi: client(execFn),
    execFn: (file, args) => { ghCalls.push(args); return ''; },
    gitExecFn: gitStub(root),
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.secrets.extension.planned, ['CHROME_CLIENT_ID']);
  assert.deepEqual(ghCalls, [], 'a dry run sends nothing');
});

test('secrets: a REFUSED target is the operation\'s error, with the key and its fix', async () => {
  // Apple signing declared, no signing tree: the mac set is required and the
  // cascade cannot value it, so the publisher refuses and publishes nothing.
  const { root, targets } = brandWithTarget({
    target: 'desktop',
    brandEnv: 'CSC_KEY_PASSWORD=pw\n',
    extra: { certificates: { providers: { apple: { teamId: 'TEAMTEST12' } } } },
  });
  const ghCalls = [];

  const result = await service.run({
    brandId: 'fixture-brand',
    brandRoot: root,
    brandConfig: brandConfig(),
    brand: { id: 'fixture-brand', config: brandConfig(), enabledTargets: ['web'], targets: [] },
    targets,
    operations: OPERATIONS.repo,
    options: {},
    serviceData: {},
    githubApi: client(fakeGh(convergedWorld())),
    execFn: (file, args) => { ghCalls.push(args); return ''; },
    gitExecFn: gitStub(root),
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /CSC_LINK/);
  assert.match(result.error, /omega manage --service certificates/);
  assert.deepEqual(ghCalls, [], 'a refusal publishes nothing');
});
