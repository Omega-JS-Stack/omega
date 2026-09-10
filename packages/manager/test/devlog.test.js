/**
 * Devlog tests — the commit-digest pipeline against fakes and real temp git
 * repos: project-map derivation from brand configs, collect filtering (fake
 * gh api), digest/brief assembly + blocksToPost (fake writer), the publish
 * commit-and-push (real git, local bare remote), and runDevlog's brand
 * resolution + dry-run path. No live GitHub or Ghostii calls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const { DEFAULTS } = require('../src/config.js');
const { loadBrand } = require('../src/lib/brand.js');
const { collectCommits } = require('../src/devlog/lib/collect-commits.js');
const { buildProjectMap, buildBrandRepos } = require('../src/devlog/lib/project-map.js');
const { generatePost } = require('../src/devlog/lib/generate-post.js');
const { publishToWebsite, renderPostFile } = require('../src/devlog/lib/publish-website.js');
const { runDevlog } = require('../src/devlog/index.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A loaded-brand shape with just what the devlog libs read. */
function fakeBrand(id, { org = 'fixture-org', repo, name, url } = {}) {
  return {
    id,
    config: {
      brand: { id, name: name ?? `${id} brand`, url: url ?? `https://${id}.test` },
      repo: { providers: { github: { org, repo } } },
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

/** A minimal brand monorepo dir (the company.test fixture shape). */
function stageBrandDir(parentDir, dirName, { config } = {}) {
  const root = path.join(parentDir, dirName);
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), config || `{
  brand: { id: '${dirName}', name: '${dirName} brand', url: 'https://${dirName}.test' },
  targets: { web: {} },
}`);

  const website = path.join(root, 'targets', 'website');
  fs.mkdirSync(website, { recursive: true });
  fs.writeFileSync(path.join(website, 'package.json'), JSON.stringify({ name: `${dirName}-website`, private: true }));

  return root;
}

function devlogConfig(id, { enabled = true, org = 'fixture-org' } = {}) {
  return `{
  brand: { id: '${id}', name: '${id} brand', url: 'https://${id}.test' },
  targets: { web: {} },
  repo: { providers: { github: { org: '${org}' } } },
  devlog: { enabled: ${enabled}, providers: { ghostii: { orgs: ['${org}'] } } },
}`;
}

/** A company workspace with brands under ./brands. */
function stageCompany(brandSpecs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-company-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brands: { roots: ['./brands'] } }");

  const brandsDir = path.join(root, 'brands');
  fs.mkdirSync(brandsDir);
  const brands = {};
  for (const [id, config] of Object.entries(brandSpecs)) {
    brands[id] = stageBrandDir(brandsDir, id, { config });
  }

  return { root, brands };
}

// ─── Config default ──────────────────────────────────────────────────────────

test('devlog: DEFAULTS carry the devlog block, disabled with website destination', () => {
  assert.equal(DEFAULTS.devlog.enabled, false);
  // The writer is a KEY under providers (#425); its settings live inside it
  assert.deepEqual(Object.keys(DEFAULTS.devlog.providers), ['ghostii']);
  assert.deepEqual(DEFAULTS.devlog.providers.ghostii.destinations, ['website']);
  assert.equal(DEFAULTS.devlog.providers.ghostii.overrides.research, false);
  assert.ok(!('provider' in DEFAULTS.devlog), 'the flat provider pick is retired');
});

// ─── Project map ─────────────────────────────────────────────────────────────

test('devlog: project map derives repo identity like the github service (a typed slug, else `<brand.id>-omega`)', () => {
  const brands = [
    fakeBrand('alpha'),
    fakeBrand('beta', { repo: 'beta-monorepo' }),
    fakeBrand('gamma', { org: null }), // no github.org — skipped, like the service
  ];

  const map = buildProjectMap(brands);
  assert.deepEqual(map, {
    'alpha-omega': { project: 'alpha brand', url: 'https://alpha.test' },
    'beta-monorepo': { project: 'beta brand', url: 'https://beta.test' },
  });

  const repos = buildBrandRepos(brands);
  assert.deepEqual(repos, [
    { owner: 'fixture-org', repo: 'alpha-omega' },
    { owner: 'fixture-org', repo: 'beta-monorepo' },
  ]);
});

test('devlog: an owner/name slug carries its OWN owner, never repo.providers.github.org', () => {
  // ../omega-brand's real shape: org Omega-JS-Stack, repo
  // "itw-creative-works/omega-brand". An owner read off `org` scans a repo that
  // does not exist.
  const brands = [fakeBrand('acme', { org: 'Acme-Org', repo: 'itw-creative-works/acme-app' })];

  assert.deepEqual(buildProjectMap(brands), {
    'acme-app': { project: 'acme brand', url: 'https://acme.test' },
  });
  assert.deepEqual(buildBrandRepos(brands), [{ owner: 'itw-creative-works', repo: 'acme-app' }]);
});

test('devlog: excludeRepos drops repos from both map and scan list; duplicates collapse', () => {
  // The copy TYPES the slug the first brand derives, which is what makes the two
  // one repo, and the duplicate the collapse is about.
  const brands = [fakeBrand('alpha'), fakeBrand('alpha-copy', { repo: 'alpha-omega' }), fakeBrand('beta')];

  const map = buildProjectMap(brands, { excludeRepos: ['beta-omega'] });
  assert.deepEqual(Object.keys(map), ['alpha-omega']);

  const repos = buildBrandRepos(brands, { excludeRepos: ['beta-omega'] });
  assert.deepEqual(repos, [{ owner: 'fixture-org', repo: 'alpha-omega' }]);
});

// ─── Collect ─────────────────────────────────────────────────────────────────

test('devlog: collect pre-filters org listings (archived, stale, excluded, private) and probes brand repos', () => {
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
  assert.deepEqual(repos, ['fixture-org/active']);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].message, 'feat: ship the thing');
  assert.equal(commits[0].homepage, 'https://product.test');
  assert.equal(commits[0].sha.length, 7);

  // archived/stale/excluded/private never got a commits probe
  const probed = api.calls.filter((c) => c.includes('/commits'));
  assert.equal(probed.length, 2);
});

test('devlog: collect filters merge/bot/fleet/excludeCommits and caps at 30 per repo', () => {
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

  assert.equal(commits.length, 30); // newest-first cap
  assert.ok(commits.every((c) => c.message.startsWith('feat: change')));
  assert.ok(!commits.some((c) => c.message.includes('\n'))); // first line only
});

test('devlog: collect repairs --paginate concatenated page arrays', () => {
  const page1 = JSON.stringify([ghCommit('feat: page one')]);
  const page2 = JSON.stringify([ghCommit('feat: page two')]);
  const api = fakeApi([{ match: /repos\/o\/r\/commits/, body: `${page1}${page2}` }]);

  const { commits } = collectCommits({ api, brandRepos: [{ owner: 'o', repo: 'r' }], since: SINCE() });

  assert.deepEqual(commits.map((c) => c.message), ['feat: page one', 'feat: page two']);
});

// ─── Generate ────────────────────────────────────────────────────────────────

function brandConfigFor(id, overrides = {}) {
  return {
    brand: { id, name: `${id} brand`, url: `https://${id}.test`, description: 'We build things.' },
    devlog: {
      enabled: true,
      providers: { ghostii: { ...DEFAULTS.devlog.providers.ghostii, orgs: ['fixture-org'], ...overrides } },
    },
    repo: { providers: { github: { org: 'fixture-org' } } },
  };
}

test('devlog: generate groups the digest by repo, labels mapped projects, and grounds links in real work', async () => {
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
  assert.ok(captured.sourceContent.includes('## alpha — part of "Alpha" (https://alpha.test)'));
  assert.ok(captured.sourceContent.includes('- feat: one\n- fix: two'));
  assert.ok(captured.sourceContent.includes('## mystery — project: mystery (https://mystery.test)'));

  // Brief: task + blocklist + voice (brand.description fallback), links grounded
  assert.ok(captured.description.includes('First-person devlog post for alpha brand'));
  assert.ok(captured.description.includes('NEVER discuss, mention, or allude to: secret plans.'));
  assert.ok(captured.description.includes('Voice: We build things.'));
  assert.deepEqual(captured.links, ['https://alpha.test', 'https://mystery.test']);
  assert.deepEqual(captured.overrides, brandConfigFor('alpha').devlog.providers.ghostii.overrides);

  // blocksToPost: title from heading-1, header image extracted, body = the rest
  assert.equal(post.title, 'Auth Round Trips');
  assert.equal(post.slug, 'auth-round-trips');
  assert.equal(post.headerImageUrl, 'https://img.test/header.png');
  assert.equal(post.body, 'First paragraph.\n\nSecond paragraph.');
  assert.deepEqual(post.tags, ['devlog']);
});

test('devlog: generate rejects unknown providers and title-less responses', async () => {
  const commits = [{ owner: 'o', repo: 'r', homepage: '', message: 'feat: x' }];

  const quillbot = brandConfigFor('a');
  quillbot.devlog.providers = { quillbot: {} };
  await assert.rejects(
    generatePost({ brandConfig: quillbot, commits, projectMap: {}, days: 5 }),
    /Unknown devlog writer: quillbot/,
  );

  const noWriter = brandConfigFor('a');
  noWriter.devlog.providers = {};
  await assert.rejects(
    generatePost({ brandConfig: noWriter, commits, projectMap: {}, days: 5 }),
    /Unknown devlog writer: null/,
  );

  await assert.rejects(
    generatePost({
      brandConfig: brandConfigFor('a'),
      commits,
      projectMap: {},
      days: 5,
      write: async () => ({ json: [], title: '', body: '' }),
    }),
    /missing title or body/,
  );
});

// ─── Publish ─────────────────────────────────────────────────────────────────

const POST = {
  title: 'Auth Round Trips',
  slug: 'auth-round-trips',
  description: 'A week in the code.',
  tags: ['devlog'],
  categories: ['engineering'],
  body: 'The body.',
};

test('devlog: renderPostFile emits blueprint front matter with the brand author', () => {
  const file = renderPostFile(brandConfigFor('alpha'), POST);

  assert.ok(file.startsWith('---\nlayout: blueprint/blog/post\n'), 'plain frontmatter — no dispersal-era section markers (C2)');
  assert.ok(!file.includes('###'), 'marker convention retired');
  assert.ok(file.includes('post:\n  title: "Auth Round Trips"'));
  assert.ok(file.includes('  author: alpha'));
  assert.ok(file.includes('  tags: ["devlog"]'));
  assert.ok(file.endsWith('---\n\nThe body.\n'));
});

test('devlog: publish writes into the website target, commits ONLY the post file, and pushes', () => {
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
  assert.ok(postPath.includes(path.join('targets', 'website', 'src', '_posts', year, 'devlog')));
  assert.ok(postPath.endsWith('-auth-round-trips.md'));
  assert.equal(url, 'https://alpha.test/blog/auth-round-trips');

  // The commit holds exactly the post file, and it reached the remote
  const files = git('show --name-only --format= HEAD').trim().split('\n');
  assert.deepEqual(files, [path.relative(brandRoot, postPath).split(path.sep).join('/')]);
  assert.ok(git('log main --format=%s -1', bare).includes('📦 Omega: Add devlog post'));
  assert.ok(git('status --porcelain').includes('scratch.txt'));
});

test('devlog: publish throws when the brand has no website target', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-noweb-'));
  const brandRoot = stageBrandDir(tmp, 'alpha', { config: devlogConfig('alpha') });
  fs.rmSync(path.join(brandRoot, 'targets'), { recursive: true });

  const brand = loadBrand(brandRoot);
  assert.throws(() => publishToWebsite({ brand, post: POST }), /no website target under targets\//);
});

// ─── runDevlog resolution + dry-run ──────────────────────────────────────────

test('devlog: company runs need exactly one enabled brand (or --brand)', async () => {
  const none = stageCompany({
    'brand-a': devlogConfig('brand-a', { enabled: false }),
    'brand-b': devlogConfig('brand-b', { enabled: false }),
  });
  await assert.rejects(runDevlog(none.root), /No brand has devlog.enabled/);

  const both = stageCompany({
    'brand-a': devlogConfig('brand-a'),
    'brand-b': devlogConfig('brand-b'),
  });
  await assert.rejects(runDevlog(both.root), /Multiple brands have devlog.enabled \(brand-a, brand-b\)/);
  await assert.rejects(runDevlog(both.root, { brand: 'brand-z' }), /Brand not found: brand-z/);
});

test('devlog: brand-root runs enforce enabled + orgs and reject mismatched --brand', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-brand-'));
  const disabled = stageBrandDir(tmp, 'alpha', { config: devlogConfig('alpha', { enabled: false }) });
  await assert.rejects(runDevlog(disabled), /Devlog is disabled for alpha/);
  await assert.rejects(runDevlog(disabled, { brand: 'other' }), /does not match this brand root/);

  const noOrgs = stageBrandDir(tmp, 'beta', {
    config: `{
  brand: { id: 'beta', name: 'beta brand', url: 'https://beta.test' },
  targets: { web: {} },
  devlog: { enabled: true },
}`,
  });
  await assert.rejects(runDevlog(noOrgs), /No devlog.providers.ghostii.orgs configured for beta/);
});

test('devlog: an empty window reports published: false without generating', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-empty-'));
  const brandRoot = stageBrandDir(tmp, 'alpha', { config: devlogConfig('alpha') });

  const report = await runDevlog(brandRoot, {}, {
    githubApi: fakeApi([]), // every listing/probe returns []
    generatePost: async () => { throw new Error('must not generate'); },
  });

  assert.deepEqual(report, { published: false, commits: 0 });
});

// #586 — devlog talks to REAL GitHub and a real writer account, so its secrets
// chain is pinned to the `production` overlay: the shell's incidental
// environment never decides which token the run publishes with.
test('devlog: the secrets chain reads the brand .env.production overlay, whatever the shell says', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devlog-env-'));
  const brandRoot = stageBrandDir(tmp, 'alpha', { config: devlogConfig('alpha') });
  const saved = { ENVIRONMENT: process.env.ENVIRONMENT, OMEGA_TEST_MODE: process.env.OMEGA_TEST_MODE };

  fs.writeFileSync(path.join(brandRoot, '.env'), 'DEVLOG_FIXTURE_KEY="from-the-base"\n');
  fs.writeFileSync(path.join(brandRoot, '.env.development'), 'DEVLOG_FIXTURE_KEY="from-the-development-overlay"\n');
  fs.writeFileSync(path.join(brandRoot, '.env.production'), 'DEVLOG_FIXTURE_KEY="from-the-production-overlay"\n');

  try {
    delete process.env.DEVLOG_FIXTURE_KEY;
    delete process.env.OMEGA_TEST_MODE;
    process.env.ENVIRONMENT = 'development';

    await runDevlog(brandRoot, {}, {
      githubApi: fakeApi([]),
      generatePost: async () => { throw new Error('must not generate'); },
    });

    assert.equal(process.env.DEVLOG_FIXTURE_KEY, 'from-the-production-overlay', 'the devlog lane pins production — a development shell never swaps the overlay');
  } finally {
    delete process.env.DEVLOG_FIXTURE_KEY;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('devlog: --dry-run previews to .omega/devlog/ and picks the single enabled company brand', async () => {
  const { root, brands } = stageCompany({
    'brand-a': devlogConfig('brand-a', { enabled: false }),
    'brand-b': devlogConfig('brand-b'),
  });

  const api = fakeApi([
    { match: /^orgs\/fixture-org\/repos/, body: [{ name: 'tool', archived: false, private: false, pushed_at: FRESH() }] },
    { match: /repos\/fixture-org\/tool\/commits/, body: [ghCommit('feat: sharpen the tool')] },
    { match: /repos\/fixture-org\/brand-(a|b)\/commits/, body: new Error('404') },
  ]);

  const report = await runDevlog(root, { dryRun: true }, {
    githubApi: api,
    generatePost: async ({ commits, projectMap }) => {
      // The sibling map covers BOTH brands even though only one publishes
      assert.deepEqual(Object.keys(projectMap).sort(), ['brand-a-omega', 'brand-b-omega']);
      assert.equal(commits.length, 1);
      return { ...POST, slug: 'sharpen-the-tool' };
    },
  });

  assert.equal(report.published, false);
  assert.equal(report.commits, 1);
  assert.equal(report.previewPath, path.join(brands['brand-b'], '.omega', 'devlog', 'sharpen-the-tool.md'));
  assert.ok(fs.readFileSync(report.previewPath, 'utf8').includes('layout: blueprint/blog/post'));
});
