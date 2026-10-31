/**
 * Devlog tests — the commit-digest pipeline against fakes and real temp git
 * repos: project-map derivation from brand configs, collect filtering (fake
 * gh api), digest/brief assembly + blocksToPost (fake writer), the publish
 * commit-and-push (real git, local bare remote), and runDevlog's brand
 * resolution + dry-run path. No live GitHub or Ghostii calls.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { recordBrand } = require('@omega.js/config');

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677). Tests that need their own
// home still override it per test.
require('@omega.js/devkit/test/temp-home');

const { DEFAULTS } = require('../src/config.js');
const { loadBrand } = require('../src/lib/brand.js');
const { collectCommits } = require('../src/devlog/lib/collect-commits.js');
const { buildProjectMap, buildBrandRepos } = require('../src/devlog/lib/project-map.js');
const { generatePost } = require('../src/devlog/lib/generate-post.js');
const { publishToWebsite, renderPostFile } = require('../src/devlog/lib/publish-website.js');
const { runDevlog } = require('../src/devlog/index.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A loaded-brand shape with just what the devlog libs read. */
function fakeBrand(id, { owner = 'fixture-org', name, url } = {}) {
  return {
    id,
    config: {
      brand: { id, name: name ?? `${id} brand`, url: url ?? `https://${id}.test` },
      ...(owner ? { repo: { provider: 'github', owner } } : {}),
    },
  };
}

/**
 * A fake GitHubAPI: routes = [{ match: RegExp, body: Array|string|Error }].
 * Bodies are JSON-stringified unless already a string (the pagination test
 * feeds a raw `][` boundary); Errors throw like a failed gh call.
 */
function fakeApi(routes) {
  const calls = [];

  return {
    calls,
    runCommand(args) {
      // The real client takes an argv array (execFileSync, no shell)
      const argv = Array.isArray(args) ? args : [args];
      const joined = argv.join(' ');
      calls.push(joined);
      const apiPath = argv[0] === 'api' ? argv[1] : joined;
      const route = routes.find((r) => r.match.test(apiPath));

      if (!route) return JSON.stringify([]);
      if (route.body instanceof Error) throw route.body;
      return typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    },
  };
}

/** A gh commits-endpoint entry. */
function ghCommit(message, { login = 'ian', authorName = 'Ian' } = {}) {
  return {
    sha: 'abcdef0123456789',
    commit: { message, author: { name: authorName, date: '2026-07-09T10:00:00Z' } },
    author: { login },
  };
}

const FRESH = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const SINCE = () => new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

/** A Ghostii-shaped article response built from blocks. */
const ARTICLE = {
  json: [
    { name: 'heading-1', content: '# Auth Round Trips' },
    { name: 'image', content: '![alt](https://img.test/header.png)' },
    { name: 'paragraph', content: 'First paragraph.' },
    { name: 'paragraph', content: 'Second paragraph.' },
  ],
  description: 'A week in the code.',
  keywords: ['devlog'],
  categories: ['engineering'],
};

/** A minimal brand monorepo dir. */
function stageBrandDir(parentDir, dirName, { config } = {}) {
  const root = path.join(parentDir, dirName);
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), config || `{
  brand: { id: '${dirName}', name: '${dirName} brand', url: 'https://${dirName}.test' },
  targets: { web: { type: 'web' } },
}`);

  const web = path.join(root, 'targets', 'web');
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, 'package.json'), JSON.stringify({ name: `${dirName}-web`, private: true }));

  return root;
}

function devlogConfig(id, { enabled = true, org = 'fixture-org' } = {}) {
  return `{
  brand: { id: '${id}', name: '${id} brand', url: 'https://${id}.test' },
  targets: { web: { type: 'web' } },
  repo: { provider: 'github', owner: '${org}' },
  devlog: { enabled: ${enabled}, providers: { ghostii: { orgs: ['${org}'] } } },
}`;
}

// ─── Generate ────────────────────────────────────────────────────────────────

function brandConfigFor(id, overrides = {}) {
  return {
    brand: { id, name: `${id} brand`, url: `https://${id}.test`, description: 'We build things.' },
    devlog: {
      enabled: true,
      providers: { ghostii: { ...DEFAULTS.devlog.providers.ghostii, orgs: ['fixture-org'], ...overrides } },
    },
    repo: { provider: 'github', owner: 'fixture-org' },
  };
}

// ─── Publish ─────────────────────────────────────────────────────────────────

const POST = {
  title: 'Auth Round Trips',
  slug: 'auth-round-trips',
  description: 'A week in the code.',
  tags: ['devlog'],
  categories: ['engineering'],
  body: 'The body.',
};

module.exports = defineCases({
  type: 'group',
  description: 'devlog',
  tests: [
    // ─── Config default ──────────────────────────────────────────────────────────

    {
      name: 'devlog: DEFAULTS carry the devlog block, disabled with website destination',
      run: (ctx) => {
        ctx.expect(DEFAULTS.devlog.enabled).toBe(false);
        // The writer is a KEY under providers (#425); its settings live inside it
        ctx.expect(Object.keys(DEFAULTS.devlog.providers)).toEqual(['ghostii']);
        ctx.expect(DEFAULTS.devlog.providers.ghostii.destinations).toEqual(['website']);
        ctx.expect(DEFAULTS.devlog.providers.ghostii.overrides.research).toBe(false);
        ctx.expect(!('provider' in DEFAULTS.devlog), 'the flat provider pick is retired').toBeTruthy();
      },
    },

    // ─── Project map ─────────────────────────────────────────────────────────────

    {
      name: 'devlog: the project map addresses the SOURCE repo the one derivation names (#883)',
      run: (ctx) => {
        const brands = [
          fakeBrand('alpha'),
          fakeBrand('beta'),
          fakeBrand('gamma', { owner: null }), // no repo.owner: skipped, like the repo service
        ];

        const map = buildProjectMap(brands);
        ctx.expect(map).toEqual({
          'alpha-omega': { project: 'alpha brand', url: 'https://alpha.test' },
          'beta-omega': { project: 'beta brand', url: 'https://beta.test' },
        });

        const repos = buildBrandRepos(brands);
        ctx.expect(repos).toEqual([
          { owner: 'fixture-org', repo: 'alpha-omega' },
          { owner: 'fixture-org', repo: 'beta-omega' },
        ]);
      },
    },

    {
      name: 'devlog: a brand under another owner scans THAT owner, never the first one',
      run: (ctx) => {
        const brands = [fakeBrand('acme', { owner: 'Acme-Org' })];

        ctx.expect(buildProjectMap(brands)).toEqual({
          'acme-omega': { project: 'acme brand', url: 'https://acme.test' },
        });
        ctx.expect(buildBrandRepos(brands)).toEqual([{ owner: 'Acme-Org', repo: 'acme-omega' }]);
      },
    },

    {
      name: 'devlog: excludeRepos drops repos from both map and scan list; duplicates collapse',
      run: (ctx) => {
        // Two brands in one org whose ids derive the same source repo are ONE repo,
        // and the duplicate the collapse is about.
        const brands = [fakeBrand('alpha'), fakeBrand('alpha'), fakeBrand('beta')];

        const map = buildProjectMap(brands, { excludeRepos: ['beta-omega'] });
        ctx.expect(Object.keys(map)).toEqual(['alpha-omega']);

        const repos = buildBrandRepos(brands, { excludeRepos: ['beta-omega'] });
        ctx.expect(repos).toEqual([{ owner: 'fixture-org', repo: 'alpha-omega' }]);
      },
    },

    // ─── Collect ─────────────────────────────────────────────────────────────────

    {
      name: 'devlog: collect pre-filters org listings (archived, stale, excluded, private) and probes brand repos',
      run: (ctx) => {
        const api = fakeApi([
          {
            match: /^orgs\/fixture-org\/repos/,
            body: [
              { name: 'active', archived: false, private: false, pushed_at: FRESH(), homepage: 'https://product.test' },
              { name: 'archived', archived: true, private: false, pushed_at: FRESH() },
              { name: 'stale', archived: false, private: false, pushed_at: '2020-01-01T00:00:00Z' },
              { name: 'excluded', archived: false, private: false, pushed_at: FRESH() },
              { name: 'secret', archived: false, private: true, pushed_at: FRESH() },
            ],
          },
          { match: /repos\/fixture-org\/active\/commits/, body: [ghCommit('feat: ship the thing')] },
          { match: /repos\/other-org\/brand-repo\/commits/, body: new Error('gh command failed: 404') },
        ]);

        const { commits, repos } = collectCommits({
          api,
          orgs: ['fixture-org'],
          brandRepos: [{ owner: 'other-org', repo: 'brand-repo' }],
          since: SINCE(),
          excludeRepos: ['excluded'],
          includePrivate: false,
        });

        // Only `active` produced commits; the missing brand repo skipped quietly
        ctx.expect(repos).toEqual(['fixture-org/active']);
        ctx.expect(commits.length).toBe(1);
        ctx.expect(commits[0].message).toBe('feat: ship the thing');
        ctx.expect(commits[0].homepage).toBe('https://product.test');
        ctx.expect(commits[0].sha.length).toBe(7);

        // archived/stale/excluded/private never got a commits probe
        const probed = api.calls.filter((c) => c.includes('/commits'));
        ctx.expect(probed.length).toBe(2);
      },
    },

    {
      name: 'devlog: collect filters merge/bot/fleet/excludeCommits and caps at 30 per repo',
      run: (ctx) => {
        const noisy = [
          ghCommit('Merge branch main'),
          ghCommit('📦 Omega: Add devlog post 2026-07-09-x'),
          ghCommit('chore: bump deps', { login: 'renovate[bot]' }),
          ghCommit('sneaky: mentions ProjectX rewrite'),
          ...Array.from({ length: 40 }, (_, i) => ghCommit(`feat: change ${i}\n\nbody line`)),
        ];
        const api = fakeApi([{ match: /repos\/o\/r\/commits/, body: noisy }]);

        const { commits } = collectCommits({
          api,
          brandRepos: [{ owner: 'o', repo: 'r' }],
          since: SINCE(),
          excludeCommits: ['projectx'],
        });

        ctx.expect(commits.length).toBe(30); // newest-first cap
        ctx.expect(commits.every((c) => c.message.startsWith('feat: change'))).toBeTruthy();
        ctx.expect(!commits.some((c) => c.message.includes('\n'))).toBeTruthy(); // first line only
      },
    },

    {
      name: 'devlog: collect repairs --paginate concatenated page arrays',
      run: (ctx) => {
        const page1 = JSON.stringify([ghCommit('feat: page one')]);
        const page2 = JSON.stringify([ghCommit('feat: page two')]);
        const api = fakeApi([{ match: /repos\/o\/r\/commits/, body: `${page1}${page2}` }]);

        const { commits } = collectCommits({ api, brandRepos: [{ owner: 'o', repo: 'r' }], since: SINCE() });

        ctx.expect(commits.map((c) => c.message)).toEqual(['feat: page one', 'feat: page two']);
      },
    },

    {
      name: 'devlog: generate groups the digest by repo, labels mapped projects, and grounds links in real work',
      run: async (ctx) => {
        const commits = [
          { owner: 'o', repo: 'alpha', homepage: '', message: 'feat: one' },
          { owner: 'o', repo: 'alpha', homepage: '', message: 'fix: two' },
          { owner: 'o', repo: 'mystery', homepage: 'https://mystery.test', message: 'feat: three' },
        ];
        const projectMap = { alpha: { project: 'Alpha', url: 'https://alpha.test' } };

        let captured;
        const post = await generatePost({
          brandConfig: brandConfigFor('alpha', { excludeTopics: ['secret plans'] }),
          commits,
          projectMap,
          days: 5,
          write: async (args) => { captured = args; return ARTICLE; },
        });

        // Digest: repo sections with project labels; unmapped repo falls back to homepage
        ctx.expect(captured.sourceContent.includes('## alpha — part of "Alpha" (https://alpha.test)')).toBeTruthy();
        ctx.expect(captured.sourceContent.includes('- feat: one\n- fix: two')).toBeTruthy();
        ctx.expect(captured.sourceContent.includes('## mystery — project: mystery (https://mystery.test)')).toBeTruthy();

        // Brief: task + blocklist + voice (brand.description fallback), links grounded
        ctx.expect(captured.description.includes('First-person devlog post for alpha brand')).toBeTruthy();
        ctx.expect(captured.description.includes('NEVER discuss, mention, or allude to: secret plans.')).toBeTruthy();
        ctx.expect(captured.description.includes('Voice: We build things.')).toBeTruthy();
        ctx.expect(captured.links).toEqual(['https://alpha.test', 'https://mystery.test']);
        ctx.expect(captured.overrides).toEqual(brandConfigFor('alpha').devlog.providers.ghostii.overrides);

        // blocksToPost: title from heading-1, header image extracted, body = the rest
        ctx.expect(post.title).toBe('Auth Round Trips');
        ctx.expect(post.slug).toBe('auth-round-trips');
        ctx.expect(post.headerImageUrl).toBe('https://img.test/header.png');
        ctx.expect(post.body).toBe('First paragraph.\n\nSecond paragraph.');
        ctx.expect(post.tags).toEqual(['devlog']);
      },
    },

    {
      name: 'devlog: generate rejects unknown providers and title-less responses',
      run: async (ctx) => {
        const commits = [{ owner: 'o', repo: 'r', homepage: '', message: 'feat: x' }];

        const quillbot = brandConfigFor('a');
        quillbot.devlog.providers = { quillbot: {} };
        await ctx.expect(generatePost({ brandConfig: quillbot, commits, projectMap: {}, days: 5 })).rejects.toThrow(/Unknown devlog writer: quillbot/);

        const noWriter = brandConfigFor('a');
        noWriter.devlog.providers = {};
        await ctx.expect(generatePost({ brandConfig: noWriter, commits, projectMap: {}, days: 5 })).rejects.toThrow(/Unknown devlog writer: null/);

        await ctx.expect(generatePost({
            brandConfig: brandConfigFor('a'),
            commits,
            projectMap: {},
            days: 5,
            write: async () => ({ json: [], title: '', body: '' }),
          })).rejects.toThrow(/missing title or body/);
      },
    },

    {
      name: 'devlog: generate slugs a title with the shared slugifier, deleting its apostrophe',
      run: async (ctx) => {
        const post = await generatePost({
          brandConfig: brandConfigFor('a'),
          commits: [{ owner: 'o', repo: 'r', homepage: '', message: 'feat: x' }],
          projectMap: {},
          days: 5,
          write: async () => ({ json: [], title: 'Don\'t Panic', body: 'Body.' }),
        });

        ctx.expect(post.slug).toBe('dont-panic');
      },
    },

    {
      name: 'devlog: renderPostFile emits blueprint front matter with the brand author',
      run: (ctx) => {
        const file = renderPostFile(brandConfigFor('alpha'), POST);

        ctx.expect(file.startsWith('---\nlayout: blueprint/blog/post\n'), 'plain frontmatter — no dispersal-era section markers (C2)').toBeTruthy();
        ctx.expect(!file.includes('###'), 'marker convention retired').toBeTruthy();
        ctx.expect(file.includes('post:\n  title: "Auth Round Trips"')).toBeTruthy();
        ctx.expect(file.includes('  author: alpha')).toBeTruthy();
        ctx.expect(file.includes('  tags: ["devlog"]')).toBeTruthy();
        ctx.expect(file.endsWith('---\n\nThe body.\n')).toBeTruthy();
      },
    },

    {
      name: 'devlog: publish writes into the website target, commits ONLY the post file, and pushes',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-publish-'));
        const brandRoot = stageBrandDir(tmp, 'alpha', { config: devlogConfig('alpha') });

        const git = (args, cwd = brandRoot) => execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const bare = path.join(tmp, 'remote.git');
        execSync(`git init --bare "${bare}"`, { encoding: 'utf8' });
        git('init -b main');
        git('config user.email devlog@test.local && git config user.name Devlog', brandRoot);
        git('add -A && git commit -m "init" -q', brandRoot);
        git(`remote add origin "${bare}"`);
        git('push -u origin main -q');

        // An unrelated dirty file must survive untouched and uncommitted
        fs.writeFileSync(path.join(brandRoot, 'scratch.txt'), 'dirty');

        const brand = loadBrand(brandRoot);
        const { postPath, url } = publishToWebsite({ brand, post: POST });

        const year = String(new Date().getFullYear());
        ctx.expect(postPath.includes(path.join('targets', 'web', 'src', '_posts', year, 'devlog'))).toBeTruthy();
        ctx.expect(postPath.endsWith('-auth-round-trips.md')).toBeTruthy();
        ctx.expect(url).toBe('https://alpha.test/blog/auth-round-trips');

        // The commit holds exactly the post file, and it reached the remote
        const files = git('show --name-only --format= HEAD').trim().split('\n');
        ctx.expect(files).toEqual([path.relative(brandRoot, postPath).split(path.sep).join('/')]);
        ctx.expect(git('log main --format=%s -1', bare).includes('📦 Omega: Add devlog post')).toBeTruthy();
        ctx.expect(git('status --porcelain').includes('scratch.txt')).toBeTruthy();
      },
    },

    {
      name: 'devlog: publish throws when the brand has no website target',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-noweb-'));
        const brandRoot = stageBrandDir(tmp, 'alpha', { config: devlogConfig('alpha') });
        fs.rmSync(path.join(brandRoot, 'targets'), { recursive: true });

        const brand = loadBrand(brandRoot);
        ctx.expect(() => publishToWebsite({ brand, post: POST })).toThrow(/no website target under targets\//);
      },
    },

    // ─── runDevlog resolution + dry-run ──────────────────────────────────────────

    {
      name: 'devlog: brand-root runs enforce enabled + orgs and reject mismatched --brand',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-brand-'));
        const disabled = stageBrandDir(tmp, 'alpha', { config: devlogConfig('alpha', { enabled: false }) });
        await ctx.expect(runDevlog(disabled)).rejects.toThrow(/Devlog is disabled for alpha/);
        await ctx.expect(runDevlog(disabled, { brand: 'other' })).rejects.toThrow(/does not match this brand root/);

        const noOrgs = stageBrandDir(tmp, 'beta', {
          config: `{
  brand: { id: 'beta', name: 'beta brand', url: 'https://beta.test' },
  targets: { web: { type: 'web' } },
  devlog: { enabled: true },
}`,
        });
        await ctx.expect(runDevlog(noOrgs)).rejects.toThrow(/No devlog.providers.ghostii.orgs configured for beta/);
      },
    },

    {
      name: 'devlog: an empty window reports published: false without generating',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-empty-'));
        const brandRoot = stageBrandDir(tmp, 'alpha', { config: devlogConfig('alpha') });

        const report = await runDevlog(brandRoot, {}, {
          githubApi: fakeApi([]), // every listing/probe returns []
          generatePost: async () => { throw new Error('must not generate'); },
        });

        ctx.expect(report).toEqual({ published: false, commits: 0 });
      },
    },

    // #586 — devlog talks to REAL GitHub and a real writer account, so its secrets
    // chain is pinned to the `production` overlay: the shell's incidental
    // environment never decides which token the run publishes with.
    {
      name: 'devlog: the secrets chain reads the brand .env.production overlay, whatever the shell says',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-env-'));
        const brandRoot = stageBrandDir(tmp, 'alpha', { config: devlogConfig('alpha') });
        const saved = { ENVIRONMENT: process.env.ENVIRONMENT, OMEGA_ENVIRONMENT: process.env.OMEGA_ENVIRONMENT };

        fs.writeFileSync(path.join(brandRoot, '.env'), 'DEVLOG_FIXTURE_KEY="from-the-base"\n');
        fs.writeFileSync(path.join(brandRoot, '.env.development'), 'DEVLOG_FIXTURE_KEY="from-the-development-overlay"\n');
        fs.writeFileSync(path.join(brandRoot, '.env.production'), 'DEVLOG_FIXTURE_KEY="from-the-production-overlay"\n');

        try {
          delete process.env.DEVLOG_FIXTURE_KEY;
          delete process.env.OMEGA_ENVIRONMENT;
          process.env.ENVIRONMENT = 'development';

          await runDevlog(brandRoot, {}, {
            githubApi: fakeApi([]),
            generatePost: async () => { throw new Error('must not generate'); },
          });

          ctx.expect(process.env.DEVLOG_FIXTURE_KEY, 'the devlog lane pins production — a development shell never swaps the overlay').toBe('from-the-production-overlay');
        } finally {
          delete process.env.DEVLOG_FIXTURE_KEY;
          for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'devlog: --dry-run previews to the brand\'s .omega/devlog/',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-dry-'));
        const brandRoot = stageBrandDir(tmp, 'brand-b', { config: devlogConfig('brand-b') });

        const api = fakeApi([
          { match: /^orgs\/fixture-org\/repos/, body: [{ name: 'tool', archived: false, private: false, pushed_at: FRESH() }] },
          { match: /repos\/fixture-org\/tool\/commits/, body: [ghCommit('feat: sharpen the tool')] },
          { match: /repos\/fixture-org\/brand-b\/commits/, body: new Error('404') },
        ]);

        const report = await runDevlog(brandRoot, { dryRun: true }, {
          githubApi: api,
          generatePost: async ({ commits, projectMap }) => {
            ctx.expect(Object.keys(projectMap).sort()).toEqual(['brand-b-omega']);
            ctx.expect(commits.length).toBe(1);
            return { ...POST, slug: 'sharpen-the-tool' };
          },
        });

        ctx.expect(report.published).toBe(false);
        ctx.expect(report.commits).toBe(1);
        ctx.expect(report.previewPath).toBe(path.join(brandRoot, '.omega', 'devlog', 'sharpen-the-tool.md'));
        ctx.expect(fs.readFileSync(report.previewPath, 'utf8').includes('layout: blueprint/blog/post')).toBeTruthy();
      },
    },

    // #677: the company layer is a layer likeany other: the shared `.env` inside
    // the company brand's `company/` tree loads UNDER the brand's own.
    {
      name: 'devlog: the company .env resolves through the ONE resolver and loads under the brand\'s',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-co-'));
        const brandRoot = stageBrandDir(tmp, 'alpha', {
          config: devlogConfig('alpha').replace('{', "{\n  company: { id: 'fixture-co' },"),
        });

        // The company brand, its tree, and the registry line its own run wrote
        const companyBrandRoot = path.join(tmp, 'fixture-co');
        fs.mkdirSync(path.join(companyBrandRoot, 'company'), { recursive: true });
        fs.writeFileSync(path.join(companyBrandRoot, 'company', '.env'), 'DEVLOG_COMPANY_KEY="from-the-company"\nDEVLOG_SHARED_KEY="from-the-company"\n');
        fs.writeFileSync(path.join(brandRoot, '.env'), 'DEVLOG_SHARED_KEY="from-the-brand"\n');

        const previousHome = process.env.OMEGA_HOME;
        process.env.OMEGA_HOME = path.join(tmp, 'home');
        ctx.after(() => {
          delete process.env.DEVLOG_COMPANY_KEY;
          delete process.env.DEVLOG_SHARED_KEY;
          if (previousHome === undefined) delete process.env.OMEGA_HOME;
          else process.env.OMEGA_HOME = previousHome;
          fs.rmSync(tmp, { recursive: true, force: true });
        });
        recordBrand({ id: 'fixture-co', root: companyBrandRoot, name: 'Fixture Co', url: 'https://fixture-co.test' });

        await runDevlog(brandRoot, {}, {
          githubApi: fakeApi([]),
          generatePost: async () => { throw new Error('must not generate'); },
        });

        ctx.expect(process.env.DEVLOG_COMPANY_KEY, 'the company layer fills the gap').toBe('from-the-company');
        ctx.expect(process.env.DEVLOG_SHARED_KEY, 'the brand still wins over its company').toBe('from-the-brand');
      },
    },
  ],
});
