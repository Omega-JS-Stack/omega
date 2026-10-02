/**
 * The repo derivations ([#883](https://github.com/Omega-JS-Stack/omega/issues/883)):
 * ONE `repo: { provider, owner }` block, every repo name derived from
 * `<brand.id>-<role>` (#809), and visibility read off the brand root's
 * package.json rather than any config key.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  REPO_PROVIDERS,
  HOSTING_PROVIDERS,
  repoBlock,
  sourceRepo,
  releasesRepo,
  repoDrift,
  repoMissing,
  websiteRepo,
  hostingProvider,
  pagesHost,
  brandVisibility,
} = require('../src/index.js');

const BRAND = {
  brand: { id: 'acme', url: 'https://acme.com' },
  repo: { owner: 'Acme-Org' },
  targets: {
    web: { type: 'web' },
    community: { type: 'web' },
    backend: { type: 'backend' },
    desktop: { type: 'desktop' },
  },
};

test('the provider tables name what OMEGA builds for', () => {
  assert.deepEqual(REPO_PROVIDERS, ['github']);
  assert.deepEqual(HOSTING_PROVIDERS, ['github']);
});

test('repoBlock: the provider defaults to github, and the owner comes back trimmed', () => {
  assert.deepEqual(repoBlock({ repo: { owner: 'Acme-Org' } }), { provider: 'github', owner: 'Acme-Org' });
  assert.deepEqual(repoBlock({ repo: { provider: 'github', owner: '  Acme-Org  ' } }), { provider: 'github', owner: 'Acme-Org' });
});

test('repo.owner: the whole block reads back as { provider, owner }, and the source repo lives under that owner', () => {
  const config = { brand: { id: 'acme' }, repo: { provider: 'github', owner: 'Acme' } };
  assert.deepEqual(repoBlock(config), { provider: 'github', owner: 'Acme' });
  assert.deepEqual(sourceRepo(config), { owner: 'Acme', name: 'acme-omega', slug: 'Acme/acme-omega' });
});

test('repoBlock: no block, and a block naming no owner, address nothing', () => {
  assert.equal(repoBlock({}), null);
  assert.equal(repoBlock({ repo: { provider: 'github' } }), null, 'the validator fails an owner-less block; nothing derives from it');
  assert.equal(repoBlock({ repo: { provider: 'github', org: 'Acme-Org' } }), null, 'the retired org key is no alias for owner');
  assert.equal(repoBlock({ repo: 'Acme-Org' }), null);
  assert.equal(repoBlock(undefined), null);
});

test('sourceRepo: the SOURCE monorepo is `<brand.id>-omega` under the owner', () => {
  // Hard-coded on purpose: the rule is a NAME, not a recipe to recompute here.
  assert.deepEqual(sourceRepo(BRAND), { owner: 'Acme-Org', name: 'acme-omega', slug: 'Acme-Org/acme-omega' });
  assert.deepEqual(
    sourceRepo({ brand: { id: '  spaced  ' }, repo: { owner: 'Org' } }),
    { owner: 'Org', name: 'spaced-omega', slug: 'Org/spaced-omega' },
    'the id is trimmed before the role joins it',
  );
});

test('releasesRepo: the public release channel is `<brand.id>-releases`, with no override left anywhere', () => {
  assert.deepEqual(releasesRepo(BRAND), { owner: 'Acme-Org', name: 'acme-releases', slug: 'Acme-Org/acme-releases' });

  // The retired owner/repo keys are inert: a config still carrying them (the
  // validator fails it) never moves the address.
  assert.deepEqual(
    releasesRepo({ ...BRAND, targets: { desktop: { type: 'desktop', releases: { owner: 'Elsewhere', repo: 'bins' } } } }),
    { owner: 'Acme-Org', name: 'acme-releases', slug: 'Acme-Org/acme-releases' },
  );
});

test('sourceRepo/releasesRepo: half an address addresses nothing', () => {
  assert.equal(sourceRepo({ brand: { id: 'acme' } }), null);
  assert.equal(sourceRepo({ repo: { owner: 'Acme-Org' } }), null);
  assert.equal(sourceRepo({}), null);
  assert.equal(releasesRepo({ brand: { id: 'acme' } }), null);
  assert.equal(releasesRepo({ repo: { owner: 'Acme-Org' } }), null);
});

test('repoDrift: an origin that IS the derived source repo is no drift, compared case-insensitively (#934)', () => {
  assert.equal(repoDrift('Acme-Org/acme-omega', BRAND), null);
  assert.equal(repoDrift('acme-org/ACME-Omega', BRAND), null, 'GitHub\'s own comparison ignores case, and so does this one');
});

test('repoDrift: another owner OR another name is the one drift line, naming both slugs (#934)', () => {
  // A transfer: the name agrees, the owner does not.
  assert.equal(
    repoDrift('Other-Org/acme-omega', BRAND),
    'origin is Other-Org/acme-omega but config derives Acme-Org/acme-omega: fix repo.owner in config/omega.json5 or move the repo',
  );
  // A rename: the owner agrees, the name does not. The owner-only compare this
  // replaced let this one through silently.
  assert.equal(
    repoDrift('Acme-Org/acme-site', BRAND),
    'origin is Acme-Org/acme-site but config derives Acme-Org/acme-omega: fix repo.owner in config/omega.json5 or move the repo',
  );
});

test('repoDrift: a config that derives no source repo has nothing to disagree with (#934)', () => {
  assert.equal(repoDrift('Acme-Org/acme-omega', { brand: { id: 'acme' } }), null, 'no owner');
  assert.equal(repoDrift('Acme-Org/acme-omega', { repo: { owner: 'Acme-Org' } }), null, 'no brand id');
});

// The one guidance line every unaddressable-repo refusal quotes after its own
// lead. It names the repo by ROLE, so the placeholders stay literal.
test('repoMissing: the source role names `<brand.id>-omega`', () => {
  assert.equal(
    repoMissing('source'),
    'Set repo.owner and brand.id in config/omega.json5: the source repo is <brand.id>-omega under that owner.',
  );
});

test('repoMissing: the releases role names `<brand.id>-releases`', () => {
  assert.equal(
    repoMissing('releases'),
    'Set repo.owner and brand.id in config/omega.json5: the releases repo is <brand.id>-releases under that owner.',
  );
});

test('repoMissing: the website role names `<brand.id>-<target name>`', () => {
  assert.equal(
    repoMissing('website'),
    'Set repo.owner and brand.id in config/omega.json5: the website repo is <brand.id>-<target name> under that owner.',
  );
});

test('repoMissing: an unknown role throws, never a line naming nothing', () => {
  assert.equal(typeof repoMissing, 'function', 'the throw below is the role check, not a missing export');
  assert.throws(() => repoMissing('content'));
  assert.throws(() => repoMissing(undefined));
});

test('websiteRepo: a web target publishes to `<brand.id>-<its name>`', () => {
  assert.deepEqual(websiteRepo(BRAND, 'web'), { owner: 'Acme-Org', name: 'acme-web', slug: 'Acme-Org/acme-web' });
  assert.deepEqual(
    websiteRepo(BRAND, 'community'),
    { owner: 'Acme-Org', name: 'acme-community', slug: 'Acme-Org/acme-community' },
    'the NAME is the whole difference between two web targets',
  );
});

test('websiteRepo: null when the config addresses no repo at all', () => {
  const noOwner = { brand: { id: 'acme' }, targets: { web: { type: 'web' } } };
  assert.equal(websiteRepo(noOwner, 'web'), null);
});

test('websiteRepo: only a WEB target is served from its own repo', () => {
  assert.throws(() => websiteRepo(BRAND, 'backend'), /targets\.backend is a backend target/);
  assert.throws(() => websiteRepo(BRAND, 'desktop'), /targets\.desktop is a desktop target/);
});

test('websiteRepo/hostingProvider: an undeclared name is a mistake, never a guess', () => {
  assert.throws(() => websiteRepo(BRAND, 'blog'), /No target "blog" is declared/);
  assert.throws(() => hostingProvider(BRAND, 'blog'), /No target "blog" is declared/);
});

test('hostingProvider: the entry\'s value, else the github default', () => {
  assert.equal(hostingProvider(BRAND, 'web'), 'github');
  assert.equal(
    hostingProvider({ ...BRAND, targets: { web: { type: 'web', hosting: { provider: 'vercel' } } } }, 'web'),
    'vercel',
  );
});

test('websiteRepo: another provider means no GitHub repo to address', () => {
  const vercel = { ...BRAND, targets: { web: { type: 'web', hosting: { provider: 'vercel' } } } };
  assert.equal(websiteRepo(vercel, 'web'), null);
});

// C5/#883: the manage walk sets the Pages domain on the repo and the web
// deploy writes the CNAME file the push publishes. Two derivations of one
// domain drift, and a drifted CNAME takes the site off its address.
test('pagesHost: the target url\'s bare host, per target', () => {
  assert.equal(pagesHost(BRAND, 'web'), 'acme.com', 'the target named for its type IS the brand host');
  assert.equal(pagesHost(BRAND, 'community'), 'community.acme.com', 'a named target is its own subdomain (#588)');
  assert.equal(pagesHost({ ...BRAND, targets: { ...BRAND.targets, web: { type: 'web', url: 'https://www.acme.com/landing' } } }, 'web'), 'www.acme.com', 'a declared url wins, and its path is not part of the host');
  assert.equal(pagesHost({ brand: {}, targets: { web: { type: 'web' } } }, 'web'), '', 'no url, no domain');
});

// #366: a project site's url names its PAGES ADDRESS, so reading it as a custom
// domain would have the deploy claim `<owner>.github.io` in a CNAME and mount
// the build at `/`, where every asset 404s.
test('pagesHost: a *.github.io address is NEVER a custom domain (#366)', () => {
  const pages = (url) => pagesHost({ brand: { id: 'acme', url }, targets: { web: { type: 'web' } } }, 'web');

  assert.equal(pages('https://omega-js-stack.github.io/omega-brand/'), '');
  assert.equal(pages('https://omega-js-stack.github.io'), '', 'a bare Pages host is not one either');
  assert.equal(pages('http://OWNER.GitHub.io/Site'), '', 'host matching is case-insensitive');
  assert.equal(pages('https://github.io.example.com'), 'github.io.example.com', 'a real domain that merely CONTAINS github.io still is one');
});

test('brandVisibility: the brand root package.json `private` field, absent meaning private', (t) => {
  const root = path.join(__dirname, '..', '.temp', `repo-visibility-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'acme' }));
  assert.equal(brandVisibility(root), 'private', 'absent = private: every brand monorepo is private by default');

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'acme', private: true }));
  assert.equal(brandVisibility(root), 'private');

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'acme', private: false }));
  assert.equal(brandVisibility(root), 'public', 'only a literal false is a public brand');

  fs.rmSync(path.join(root, 'package.json'));
  assert.equal(brandVisibility(root), 'private', 'no manifest at all never reads public');
});

// C6: a MISSING manifest is the one expected absence. Anything else (a
// manifest that does not parse, a permission error) is this machine being
// broken, and 'private' is a plausible-looking answer that hides the break.
test('brandVisibility: a manifest that does not parse fails LOUDLY, never as private', (t) => {
  const root = path.join(__dirname, '..', '.temp', `repo-visibility-broken-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, 'package.json'), '{ "name": "acme", ');
  assert.throws(() => brandVisibility(root), SyntaxError);
});

// The rename leaves no reader behind: only the migrate table (which converts
// the old key) and the breaking-changes register may still say it.
test('repo.owner: no source, doc, brand config or plugin file names repo.org or --org', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const scopes = ['packages/*/src/**', 'docs/**', 'brands/*/config/**', 'agent-plugins/**'].map((glob) => `:(glob)${glob}`);
  const allowed = (file) => file.startsWith('packages/manager/src/migrate/') || file === 'docs/shared/breaking-changes.md';
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...scopes], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && !allowed(file) && fs.existsSync(path.join(root, file)));
  const hits = files.flatMap((file) => fs.readFileSync(path.join(root, file), 'utf8')
    .split('\n')
    .flatMap((line, index) => (/\brepo\.org\b|--org\b/.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])));
  assert.deepEqual(hits, []);
});
