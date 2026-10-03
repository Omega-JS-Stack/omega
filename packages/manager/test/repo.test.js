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
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('node:path');
const jetpack = require('fs-jetpack');

// The machine registry is per-machine state: this file's fixtures record into a temp home.
require('@omega.js/devkit/test/temp-home');

const devkit = require('@omega.js/devkit/github-repo');
const { OPERATIONS } = require('../src/config.js');
const service = require('../src/services/repo/index.js');
const { createGh } = require('./lib/fake-gh.js');

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
    repo: { provider: 'github', owner: 'fixture-org' },
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
 * The fake `gh` signed in to an account that sees the fixture org, answering
 * from a small world of repos, branches and pages (test/lib/fake-gh.js).
 *
 * @param {object} [world] - The account keys: `repos`, `pages`, `branches`, `plan`.
 * @returns {function} An execFn for devkit's gh(), carrying `.calls` and `.mutations()`.
 */
function ghWorld(world = {}) {
  return createGh({ user: 'fixture-user', orgs: ['fixture-org'], ...world });
}

/**
 * The gh api endpoints the run touched, in order.
 * @param {function} execFn - From ghWorld().
 * @returns {string[]} The endpoints.
 */
function endpoints(execFn) {
  return execFn.calls.filter((args) => args[0] === 'api').map((args) => args[1]);
}

/**
 * The service's GitHub client: devkit's real functions bound to the fake exec,
 * plus stubs for the three org-Actions reads.
 *
 * @param {function} execFn - From ghWorld().
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
 * @returns {object} A ghWorld() world.
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
  const execFn = ghWorld(publicWorld());
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
    repo: { provider: 'github', owner: 'fixture-org' },
    targets: { [target]: { type: target } },
    ...extra,
  }));
  jetpack.write(path.join(root, '.env'), brandEnv);

  const targetPath = path.join(root, 'targets', target);
  jetpack.write(path.join(targetPath, 'package.json'), { name: `fixture-brand-${target}`, private: true });

  // A real checkout of the brand's own SOURCE repo: the origin gate the walk's
  // setup and the publisher share reads it (#934), and it agrees.
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', `https://github.com/${SOURCE}.git`]);

  return { root, targets: [{ name: target, dir: `targets/${target}`, path: targetPath, target }] };
}

module.exports = defineCases({
  type: 'group',
  description: 'repo',
  tests: [
    // ─── Setup / skip semantics ──────────────────────────────────────────────────

    {
      name: 'repo service: a config with no repo block skips, naming repo.owner',
      run: async (ctx) => {
        const config = brandConfig();
        delete config.repo;

        const result = await run(config, client(ghWorld()));
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/repo\.owner/);
      },
    },

    {
      name: 'repo service: an owner with no brand.id fails loudly instead of ensuring half an address',
      run: async (ctx) => {
        const config = brandConfig();
        delete config.brand.id;

        await ctx.expect((() => run(config, client(ghWorld())))()).rejects.toThrow(/brand\.id/);
      },
    },

    {
      name: 'repo service: an origin that is not the derived source repo REFUSES before anything is ensured (#934)',
      run: async (ctx) => {
        // A real checkout, with the remote a rename leaves behind: same org, another
        // name, so the owner-only compare this replaced would have walked on and
        // ensured fixture-org/fixture-brand-omega beside the repo origin points at.
        const root = brandRoot(true);
        const { execFileSync } = require('node:child_process');
        execFileSync('git', ['-C', root, 'init', '-q']);
        execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/fixture-org/fixture-brand-site.git']);

        const execFn = ghWorld();

        await ctx.expect((() => run(brandConfig(), client(execFn), { root }))()).rejects.toThrow((error) => {
            ctx.expect(error.message).toBe(`origin is fixture-org/fixture-brand-site but config derives ${SOURCE}: fix repo.owner in config/omega.json5 or move the repo`);
            return true;
          });
        ctx.expect(execFn.calls, 'not one gh call: nothing read, nothing ensured').toEqual([]);
      },
    },

    {
      name: 'repo service: the operations are the two roles, the runner check, then the secrets push',
      run: (ctx) => {
        // `secrets` is LAST (#891): it publishes into the repos the roles above make.
        ctx.expect(OPERATIONS.repo.map((op) => op.name)).toEqual(['repo', 'website', 'runners', 'secrets']);
      },
    },

    // ─── The plan (dry run) ──────────────────────────────────────────────────────

    {
      name: 'dry run: the plan names the private source repo and the public website repo, and mutates nothing',
      run: async (ctx) => {
        const execFn = ghWorld();
        const result = await run(brandConfig(), client(execFn), { options: { dryRun: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(execFn.mutations()).toEqual([]);

        ctx.expect(result.output.repo.planned).toEqual([`create ${SOURCE} (private)`]);
        ctx.expect(result.output.website.planned).toEqual([`create ${WEBSITE} (public: free plan)`]);
        ctx.expect(result.output.website.repos[0].visibility).toBe('public');
      },
    },

    {
      name: 'dry run: a private brand on a PAID org plans a private website repo, saying which plan',
      run: async (ctx) => {
        const execFn = ghWorld({ plan: 'team' });
        const result = await run(brandConfig(), client(execFn), { options: { dryRun: true } });

        ctx.expect(result.output.website.planned).toEqual([`create ${WEBSITE} (private: fixture-org is on the team plan)`]);
        ctx.expect(result.output.website.repos[0].visibility).toBe('private');
      },
    },

    {
      name: 'dry run: a PUBLIC brand publishes both repos, the plan never asked about',
      run: async (ctx) => {
        const execFn = ghWorld();
        const api = client(execFn);
        const result = await run(brandConfig(), api, { root: brandRoot(false), options: { dryRun: true } });

        ctx.expect(result.output.repo.planned).toEqual([`create ${SOURCE} (public)`]);
        ctx.expect(result.output.website.planned).toEqual([`create ${WEBSITE} (public: the brand is public)`]);
        ctx.expect(api.planReads, 'a public brand needs no plan to know the answer').toBe(0);
      },
    },

    {
      name: 'visibility: a brand root with no `private` key at all is private (#883)',
      run: async (ctx) => {
        const execFn = ghWorld();
        const result = await run(brandConfig(), client(execFn), { root: brandRoot(undefined), options: { dryRun: true } });

        ctx.expect(result.output.repo.planned).toEqual([`create ${SOURCE} (private)`]);
      },
    },

    // ─── The source role ─────────────────────────────────────────────────────────

    {
      name: 'source: the repo is created private, with no homepage and no initial commit',
      run: async (ctx) => {
        const execFn = ghWorld();
        const result = await run(brandConfig(), client(execFn));

        ctx.expect(result.output.repo.created).toBe(true);
        const create = execFn.calls.find((args) => args[0] === 'repo' && args[1] === 'create');
        ctx.expect(create).toEqual(['repo', 'create', SOURCE, '--private', '--description', 'A fixture brand']);
        ctx.expect(result.state.repo.fullName).toBe(SOURCE);
      },
    },

    {
      name: 'source: visibility drift is patched back to what the brand root states',
      run: async (ctx) => {
        const world = convergedWorld();
        world.repos[SOURCE] = { private: false, homepage: '' };
        const execFn = ghWorld(world);

        const result = await run(brandConfig(), client(execFn));

        ctx.expect(result.output.repo.changed).toBe(true);
        ctx.expect(result.output.repo.planned).toEqual([`${SOURCE}: public -> private`]);
        const patch = execFn.calls.find((args) => args.includes('-X') && args[1] === `repos/${SOURCE}`);
        ctx.expect(patch).toEqual(['api', `repos/${SOURCE}`, '-X', 'PATCH', '-F', 'private=true']);
      },
    },

    {
      name: 'source: Pages still serving the source repo is a warning with the by-hand steps, never a delete',
      run: async (ctx) => {
        const world = convergedWorld();
        world.pages[SOURCE] = { source: { branch: 'gh-pages' }, cname: 'fixture-brand.test' };
        const execFn = ghWorld(world);

        const result = await run(brandConfig(), client(execFn));

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.warned).toEqual([{ operation: 'repo', reason: `${SOURCE} still serves GitHub Pages: the website moved to its own repo (#883)` }]);
        ctx.expect(execFn.mutations(), 'the walk never retires Pages on its own').toEqual([]);
      },
    },

    {
      name: 'source: Pages is never CONFIGURED on the source repo, converged or fresh',
      run: async (ctx) => {
        const converged = ghWorld(convergedWorld());
        await run(brandConfig(), client(converged));

        const fresh = ghWorld();
        await run(brandConfig(), client(fresh));

        for (const execFn of [converged, fresh]) {
          const sourcePages = execFn.calls.filter((args) => args[1] === `repos/${SOURCE}/pages` && args.includes('-X'));
          ctx.expect(sourcePages).toEqual([]);
        }
      },
    },

    // ─── The website role ────────────────────────────────────────────────────────

    {
      name: 'website: a fresh repo is created public with the target url, and Pages waits for the first deploy',
      run: async (ctx) => {
        const execFn = ghWorld();
        const result = await run(brandConfig(), client(execFn));

        const create = execFn.calls.find((args) => args[0] === 'repo' && args[1] === 'create' && args[2] === WEBSITE);
        ctx.expect(create).toEqual([
          'repo', 'create', WEBSITE, '--public',
          '--description', 'Fixture Brand website (web)',
          '--homepage', 'https://fixture-brand.test',
        ]);
        ctx.expect(!create.includes('--add-readme'), 'a repo the deploy force-pushes never starts with a commit').toBeTruthy();

        ctx.expect(result.output.website.repos[0].pagesPending).toBe(true);
        ctx.expect(endpoints(execFn).filter((endpoint) => endpoint === `repos/${WEBSITE}/pages`)).toEqual([]);
      },
    },

    {
      name: 'website: once gh-pages exists, Pages is pointed at it and at the target host',
      run: async (ctx) => {
        const execFn = ghWorld({
          repos: { [SOURCE]: { private: true }, [WEBSITE]: { private: false, homepage: 'https://fixture-brand.test' } },
          branches: { [WEBSITE]: ['gh-pages'] },
        });
        const result = await run(brandConfig(), client(execFn));

        ctx.expect(result.output.website.planned).toEqual([`pages ${WEBSITE}: gh-pages -> fixture-brand.test`]);
        const post = execFn.calls.find((args) => args[1] === `repos/${WEBSITE}/pages` && args.includes('POST'));
        ctx.expect(post).toEqual(['api', `repos/${WEBSITE}/pages`, '-X', 'POST', '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/']);
        const domain = execFn.calls.find((args) => args[1] === `repos/${WEBSITE}/pages` && args.includes('PUT'));
        ctx.expect(domain).toEqual(['api', `repos/${WEBSITE}/pages`, '-X', 'PUT', '-f', 'cname=fixture-brand.test']);
      },
    },

    {
      name: 'website: two web targets get two repos, one per NAME, off ONE plan read',
      run: async (ctx) => {
        const config = brandConfig({ targets: { web: { type: 'web' }, community: { type: 'web' } } });
        const execFn = ghWorld();
        const api = client(execFn);

        const result = await run(config, api, { options: { dryRun: true } });

        ctx.expect(result.output.website.repos.map((repo) => repo.slug)).toEqual([
          WEBSITE,
          'fixture-org/fixture-brand-community',
        ]);
        ctx.expect(api.planReads, 'the plan is the org\'s, not the target\'s').toBe(1);
        ctx.expect(result.output.website.planned.join('\n')).toMatch(/create fixture-org\/fixture-brand-community \(public: free plan\)/);
      },
    },

    {
      name: 'website: the second target\'s Pages domain is its OWN subdomain',
      run: async (ctx) => {
        const config = brandConfig({ targets: { web: { type: 'web' }, community: { type: 'web' } } });
        const execFn = ghWorld({
          repos: {
            [SOURCE]: { private: true },
            [WEBSITE]: { private: false, homepage: 'https://fixture-brand.test' },
            'fixture-org/fixture-brand-community': { private: false, homepage: 'https://community.fixture-brand.test' },
          },
          branches: { 'fixture-org/fixture-brand-community': ['gh-pages'] },
        });

        await run(config, client(execFn));

        const domain = execFn.calls.find((args) => args[1] === 'repos/fixture-org/fixture-brand-community/pages' && args.includes('PUT'));
        ctx.expect(domain).toEqual(['api', 'repos/fixture-org/fixture-brand-community/pages', '-X', 'PUT', '-f', 'cname=community.fixture-brand.test']);
      },
    },

    // C5/#366: a project site's url IS its Pages address, so the walk has no custom
    // domain to claim. The derivation is @omega.js/config's ONE `pagesHost`, the
    // same one the web deploy writes its CNAME file from: claiming
    // `<owner>.github.io` here would take the site off the address it serves at.
    {
      name: 'website: a *.github.io brand claims NO custom domain',
      run: async (ctx) => {
        const config = brandConfig();
        config.brand.url = 'https://fixture-org.github.io/fixture-brand-web/';
        const execFn = ghWorld({
          repos: { [SOURCE]: { private: true }, [WEBSITE]: { private: false, homepage: 'https://fixture-org.github.io/fixture-brand-web/' } },
          branches: { [WEBSITE]: ['gh-pages'] },
        });

        const result = await run(config, client(execFn));

        ctx.expect(result.output.website.planned, 'the branch, and no domain').toEqual([`pages ${WEBSITE}: gh-pages`]);
        const domain = execFn.calls.find((args) => args[1] === `repos/${WEBSITE}/pages` && args.includes('PUT'));
        ctx.expect(domain, 'no cname is ever PUT for a project site').toBe(undefined);
      },
    },

    {
      name: 'website: a brand with no web target owns no website repo',
      run: async (ctx) => {
        const execFn = ghWorld();
        const result = await run(brandConfig({ targets: { backend: { type: 'backend' } } }), client(execFn));

        ctx.expect(result.output.website.skipped).toBe('no GitHub-hosted web target');
        ctx.expect(endpoints(execFn).filter((endpoint) => endpoint.includes('-web'))).toEqual([]);
      },
    },

    // ─── Idempotency ─────────────────────────────────────────────────────────────

    {
      name: 'a fully converged brand is a zero-mutation no-op',
      run: async (ctx) => {
        const execFn = ghWorld(convergedWorld());
        const result = await run(brandConfig(), client(execFn));

        ctx.expect(result.status).toBe('success');
        ctx.expect(execFn.mutations()).toEqual([]);
        ctx.expect(result.output.website.planned).toEqual([]);
      },
    },

    {
      name: 'runners: an org group that allows public repositories passes',
      run: async (ctx) => {
        const { result, api } = await runDesktop({
          groups: { runner_groups: [{ id: 1, name: 'Default', allows_public_repositories: true, visibility: 'all' }] },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.runners.group).toBe('Default');
        ctx.expect(api.groupReads, 'visibility all already answers for every repo').toEqual([]);
      },
    },

    {
      name: 'runners: a selected-repositories group that lists the SOURCE repo passes (#879)',
      run: async (ctx) => {
        const { result, api } = await runDesktop({
          groups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
          repositories: { repositories: [{ name: 'fixture-brand-omega', full_name: SOURCE }] },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(api.groupReads).toEqual([['fixture-org', 7]]);
        ctx.expect(result.output.runners.group).toBe('Signers');
      },
    },

    {
      name: 'runners: a selected-repositories group without the source repo FAILS the walk (#879)',
      run: async (ctx) => {
        const { result } = await runDesktop({
          groups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
          repositories: { repositories: [{ name: 'other-omega', full_name: 'fixture-org/other-omega' }] },
        });

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.error).toMatch(/Signers/);
        ctx.expect(result.error.includes(SOURCE)).toBeTruthy();
        ctx.expect(result.error.includes(RUNNERS_LINK)).toBeTruthy();
        ctx.expect(result.failed).toEqual([{ operation: 'runners', reason: result.error }]);
      },
    },

    {
      name: 'runners: a later allowing group serves the repo when an earlier selected group leaves it out (#879)',
      run: async (ctx) => {
        const { result, api } = await runDesktop({
          groups: {
            runner_groups: [
              { id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' },
              { id: 2, name: 'Default', allows_public_repositories: true, visibility: 'all' },
            ],
          },
          repositories: { repositories: [] },
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.runners.group).toBe('Default');
        ctx.expect(api.groupReads).toEqual([['fixture-org', 7]]);
      },
    },

    {
      name: 'runners: a token without the scope to read a group\'s repositories warns with the link (#879)',
      run: async (ctx) => {
        const { result } = await runDesktop({
          groups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
          repositoriesError: 'gh api failed: HTTP 403: Resource not accessible by integration',
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.warned.at(-1).operation).toBe('runners');
        ctx.expect(result.output.runners.unreadable.includes(RUNNERS_LINK)).toBeTruthy();
      },
    },

    {
      name: 'runners: a repositories read that fails for any other reason is an error, never "check it by hand" (#879)',
      run: async (ctx) => {
        const { result } = await runDesktop({
          groups: { runner_groups: [{ id: 7, name: 'Signers', allows_public_repositories: true, visibility: 'selected' }] },
          repositoriesError: 'gh api failed: HTTP 500: Internal Server Error',
        });

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.error).toMatch(/HTTP 500/);
      },
    },

    {
      name: 'runners: no group allowing public repositories FAILS the walk, naming the checkbox and the link',
      run: async (ctx) => {
        const { result } = await runDesktop({
          groups: { runner_groups: [{ name: 'Default', allows_public_repositories: false }] },
        });

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.error).toMatch(/Allow public repositories/);
        ctx.expect(result.error.includes(RUNNERS_LINK)).toBeTruthy();
      },
    },

    {
      name: 'runners: a personal-account owner has no runner groups to read',
      run: async (ctx) => {
        const { result } = await runDesktop({ user: { type: 'User' } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.runners.skipped).toBe('owner is not an organization');
      },
    },

    {
      name: 'runners: a token without the scope to read the groups warns with the link',
      run: async (ctx) => {
        const { result } = await runDesktop({ groupsError: 'gh api failed: HTTP 403: Resource not accessible by integration' });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.runners.unreadable.includes(RUNNERS_LINK)).toBeTruthy();
      },
    },

    {
      name: 'runners: a cloud Windows signer never touches the org runner groups',
      run: async (ctx) => {
        const { result } = await runDesktop({}, { config: desktopBrand({ platforms: { windows: { signing: { strategy: 'cloud' } } } }) });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.runners.skipped).toBe('Windows signing strategy is cloud');
      },
    },

    {
      name: 'runners: the signing strategy is read off the desktop-TYPED entry, whatever it is named (#886)',
      run: async (ctx) => {
        const config = brandConfig({
          targets: { web: { type: 'web' }, app: { type: 'desktop', platforms: { windows: { signing: { strategy: 'cloud' } } } } },
        });
        const { result } = await runDesktop({}, { config });

        ctx.expect(result.output.runners.skipped, 'the entry named `app` is the desktop target').toBe('Windows signing strategy is cloud');
      },
    },

    {
      name: 'runners: a PRIVATE brand and a brand with no desktop target both skip',
      run: async (ctx) => {
        const priv = await runDesktop({}, { isPrivate: true });
        ctx.expect(priv.result.output.runners.skipped).toBe('repo is private');

        const noDesktop = await runDesktop({}, { config: brandConfig() });
        ctx.expect(noDesktop.result.output.runners.skipped).toBe('no desktop target');
      },
    },

    // ─── runners: the stray-trigger warning (#875) ───────────────────────────────
    // The org runner group says whether a dispatch REACHES the self-hosted signer;
    // this says what ELSE could reach it. A workflow with a job on the box fires on
    // a dispatch and nothing else, so a `push` or `pull_request` trigger in one is
    // warned on by name.

    {
      name: 'runners: a push trigger in a workflow that targets a self-hosted runner warns, naming the file and the trigger (#875)',
      run: async (ctx) => {
        const { result, lines } = await captureRun(() => runDesktop(
          { groups: ALLOWING },
          { workflows: { 'desktop-build.yml': workflow('  workflow_dispatch:\n  push:\n    branches: [main]') } },
        ));

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.warned.at(-1).operation).toBe('runners');
        ctx.expect(result.output.runners.strayTriggers).toEqual([{ file: 'desktop-build.yml', trigger: 'push' }]);
        // The group answer rides along: the two checks never overwrite each other.
        ctx.expect(result.output.runners.group).toBe('Default');

        const warning = lines.find((line) => line.includes('desktop-build.yml') && line.includes('push'));
        ctx.expect(warning, 'one line naming the file and the trigger').toBeTruthy();
        ctx.expect(warning).toMatch(/self-hosted/);
      },
    },

    {
      name: 'runners: a pull_request trigger is warned on too, and both are named at once (#875)',
      run: async (ctx) => {
        const { result } = await captureRun(() => runDesktop(
          { groups: ALLOWING },
          { workflows: { 'desktop-build.yml': workflow('  push:\n  pull_request:\n  workflow_dispatch:') } },
        ));

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.runners.strayTriggers).toEqual([
          { file: 'desktop-build.yml', trigger: 'push' },
          { file: 'desktop-build.yml', trigger: 'pull_request' },
        ]);
        ctx.expect(result.warned.at(-1).reason).toMatch(/desktop-build\.yml \(push\), desktop-build\.yml \(pull_request\)/);
      },
    },

    {
      name: 'runners: the dispatch-only workflows a brand actually composes warn about nothing (#875)',
      run: async (ctx) => {
        const { result } = await captureRun(() => runDesktop(
          { groups: ALLOWING },
          { workflows: { 'desktop-build.yml': workflow('  workflow_dispatch:') } },
        ));

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.runners.group).toBe('Default');
        ctx.expect(result.output.runners.strayTriggers).toBe(undefined);
      },
    },

    {
      name: 'runners: a push trigger on a HOSTED-runner workflow is nobody\'s emergency (#875)',
      run: async (ctx) => {
        const { result } = await captureRun(() => runDesktop(
          { groups: ALLOWING },
          { workflows: { 'web-build.yml': workflow('  push:\n  workflow_dispatch:', 'ubuntu-latest') } },
        ));

        ctx.expect(result.status).toBe('success');
      },
    },

    {
      name: 'runners: a trigger with a trailing COMMENT is still a stray trigger (B3)',
      run: async (ctx) => {
        const { result } = await captureRun(() => runDesktop(
          { groups: ALLOWING },
          { workflows: { 'desktop-build.yml': workflow('  workflow_dispatch:\n  push: # only main, for now') } },
        ));

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.runners.strayTriggers).toEqual([{ file: 'desktop-build.yml', trigger: 'push' }]);
      },
    },

    {
      name: 'runners: a FLOW-style trigger is still a stray trigger (C7)',
      run: async (ctx) => {
        const { result } = await captureRun(() => runDesktop(
          { groups: ALLOWING },
          { workflows: { 'desktop-build.yml': workflow('  workflow_dispatch:\n  push: { branches: [main] }') } },
        ));

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.runners.strayTriggers).toEqual([{ file: 'desktop-build.yml', trigger: 'push' }]);
      },
    },

    {
      name: 'runners: the QUOTED `"on":` key reads like the bare one (C7)',
      run: async (ctx) => {
        // YAML 1.1 reads a bare `on` as the boolean true, so a quoted key is a
        // spelling a real workflow carries, not a curiosity.
        const quoted = workflow('  workflow_dispatch:\n  push:').replace(/^on:$/m, '"on":');

        const { result } = await captureRun(() => runDesktop(
          { groups: ALLOWING },
          { workflows: { 'desktop-build.yml': quoted } },
        ));

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.runners.strayTriggers).toEqual([{ file: 'desktop-build.yml', trigger: 'push' }]);
      },
    },

    {
      name: 'runners: a stray trigger never softens the runner-group ERROR it rides with (#875)',
      run: async (ctx) => {
        const { result } = await captureRun(() => runDesktop(
          { groups: { runner_groups: [{ name: 'Default', allows_public_repositories: false }] } },
          { workflows: { 'desktop-build.yml': workflow('  push:') } },
        ));

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.error).toMatch(/Allow public repositories/);
      },
    },

    {
      name: 'secrets: a dry run plans the target\'s key NAMES and issues no gh call',
      run: async (ctx) => {
        const { root, targets } = brandWithTarget({ target: 'extension', brandEnv: 'CHROME_CLIENT_ID=client-id\n' });
        const execFn = ghWorld(convergedWorld());
        const secretsGh = ghWorld(convergedWorld());

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
          execFn: secretsGh,
        });

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.secrets.extension.planned).toEqual(['CHROME_CLIENT_ID']);
        ctx.expect(secretsGh.calls, 'a dry run sends nothing').toEqual([]);
      },
    },

    {
      name: 'secrets: a REFUSED target is the operation\'s error, with the key and its fix',
      run: async (ctx) => {
        // Apple signing declared, no signing tree: the mac set is required and the
        // cascade cannot value it, so the publisher refuses and publishes nothing.
        const { root, targets } = brandWithTarget({
          target: 'desktop',
          brandEnv: 'CSC_KEY_PASSWORD=pw\n',
          extra: { certificates: { providers: { apple: { teamId: 'TEAMTEST12' } } } },
        });
        const secretsGh = ghWorld(convergedWorld());

        const result = await service.run({
          brandId: 'fixture-brand',
          brandRoot: root,
          brandConfig: brandConfig(),
          brand: { id: 'fixture-brand', config: brandConfig(), enabledTargets: ['web'], targets: [] },
          targets,
          operations: OPERATIONS.repo,
          options: {},
          serviceData: {},
          githubApi: client(ghWorld(convergedWorld())),
          execFn: secretsGh,
        });

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.error).toMatch(/CSC_LINK/);
        ctx.expect(result.error).toMatch(/omega manage --service certificates/);
        ctx.expect(secretsGh.calls, 'a refusal publishes nothing').toEqual([]);
      },
    },
  ],
});
