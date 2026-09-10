/**
 * brandRepoName/brandRepoOwner — the shared brand-repo derivation from the
 * optional `repo.providers.github.repo` slug ("owner/name" or bare name; name → `<brand.id>-omega`,
 * the `<brand.id>-<role>` rule of #809; owner → repo.providers.github.org).
 * Born from the 2026-07-18 launch-night collision
 * (brand "omega" resolved to the framework MONOREPO); the `repoWebsite` URL
 * key is retired (2026-07-19).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { parseRepoSlug, brandRepoName, brandRepoOwner, brandRepo, releasesRepo, loadConfig } = require('../src/index.js');

test('brandRepoName: explicit owner/name slug names the repo', () => {
  assert.equal(
    brandRepoName({ repo: { providers: { github: { repo: 'itw-creative-works/omega-brand' } } }, brand: { id: 'omega' } }),
    'omega-brand',
  );
});

test('brandRepoName: bare-name slug wins over brand.id', () => {
  assert.equal(brandRepoName({ repo: { providers: { github: { repo: 'site' } } }, brand: { id: 'b' } }), 'site');
});

test('brandRepoName: the `<brand.id>-omega` default; empty when nothing resolves (the collision case needs the slug)', () => {
  assert.equal(brandRepoName({ repo: { providers: { github: {} } }, brand: { id: 'my-brand' } }), 'my-brand-omega');
  assert.equal(brandRepoName({ brand: { id: 'my-brand' } }), 'my-brand-omega');
  assert.equal(brandRepoName({ brand: { id: '  spaced  ' } }), 'spaced-omega', 'the id is trimmed before the role joins it');
  assert.equal(brandRepoName({}), '');
});

test('brandRepoName: the derived default is the brand id plus its role, never the bare id (#809)', () => {
  // Hard-coded on purpose: the rule is a NAME, not a recipe to recompute here.
  assert.equal(brandRepoName({ brand: { id: 'omega-playground' } }), 'omega-playground-omega');
});

test('brandRepoOwner: slug owner wins (legacy orgWebsite — brand repo under the paid company org)', () => {
  assert.equal(
    brandRepoOwner({ repo: { providers: { github: { org: 'Omega-JS-Stack', repo: 'itw-creative-works/omega-brand' } } } }),
    'itw-creative-works',
  );
});

test('brandRepoOwner: bare-name slug falls to repo.providers.github.org; empty when nothing resolves', () => {
  assert.equal(brandRepoOwner({ repo: { providers: { github: { org: 'Org', repo: 'just-a-name' } } } }), 'Org');
  assert.equal(brandRepoOwner({ repo: { providers: { github: { org: 'Org' } } } }), 'Org');
  assert.equal(brandRepoOwner({}), '');
});

test('backend load: the target-overlaid github.repo drives the derivation (CMS commits to the content repo, not the brand org)', (t) => {
  const root = path.join(__dirname, '..', '.temp', `repo-target-overlay-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'config', 'omega.json5'),
    `{
      brand: { id: 'acme' },
      repo: { providers: { github: { org: 'Acme-Org' } } },
      targets: { backend: { github: { repo: 'itw-creative-works/acme-brand' } } },
    }`,
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { config } = loadConfig(root, 'backend');
  assert.equal(brandRepoOwner(config), 'itw-creative-works');
  assert.equal(brandRepoName(config), 'acme-brand');
});

test('brandRepo: the finished value frameworks hand to consumer code (#290)', () => {
  assert.deepEqual(
    brandRepo({ brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org' } } } }),
    { owner: 'Acme-Org', name: 'acme-omega', repo: 'Acme-Org/acme-omega' },
  );

  // The target overlay wins, exactly as the two halves resolve it.
  assert.deepEqual(
    brandRepo({ brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org', repo: 'acme-brand' } } }, github: { repo: 'itw-creative-works/acme-content' } }),
    { owner: 'itw-creative-works', name: 'acme-content', repo: 'itw-creative-works/acme-content' },
  );
});

test('brandRepo: half an address addresses nothing — the slug stays empty', () => {
  assert.deepEqual(brandRepo({ brand: { id: 'acme' } }), { owner: '', name: 'acme-omega', repo: '' });
  assert.deepEqual(brandRepo({ repo: { providers: { github: { org: 'Acme-Org' } } } }), { owner: 'Acme-Org', name: '', repo: '' });
  assert.deepEqual(brandRepo({}), { owner: '', name: '', repo: '' });
});

test('releasesRepo: the default is `<brand.id>-releases` under the brand repo owner (#799)', () => {
  assert.deepEqual(
    releasesRepo({ brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org' } } } }),
    { owner: 'Acme-Org', name: 'acme-releases', repo: 'Acme-Org/acme-releases' },
  );

  // The brand repo's own owner, slug form included (the app repo may sit under
  // the paid company org while repo.providers.github.org names the brand's).
  assert.equal(
    releasesRepo({ brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org', repo: 'itw-creative-works/acme-brand' } } } }).owner,
    'itw-creative-works',
  );
});

test('releasesRepo: an explicit owner + repo names the repo outright', () => {
  assert.deepEqual(
    releasesRepo({
      brand: { id: 'acme' },
      repo: { providers: { github: { org: 'Acme-Org' } } },
      targets: { desktop: { releases: { owner: 'Acme-Binaries', repo: 'acme-bins' } } },
    }),
    { owner: 'Acme-Binaries', name: 'acme-bins', repo: 'Acme-Binaries/acme-bins' },
  );
});

test('releasesRepo: reads the raw shape (targets.desktop.releases) and the desktop-resolved overlay alike', () => {
  const base = { brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org' } } } };

  // Raw config, the shape the site global reads.
  assert.equal(releasesRepo({ ...base, targets: { desktop: { releases: { repo: 'bins' } } } }).repo, 'Acme-Org/bins');
  // Desktop-resolved config, where the merge chain overlaid the block on top.
  assert.equal(releasesRepo({ ...base, releases: { repo: 'bins' } }).repo, 'Acme-Org/bins');
  // Both present: the overlay is the resolved value and wins.
  assert.equal(
    releasesRepo({ ...base, releases: { repo: 'overlay' }, targets: { desktop: { releases: { repo: 'raw' } } } }).repo,
    'Acme-Org/overlay',
  );
});

test('releasesRepo: half an address addresses nothing', () => {
  assert.deepEqual(releasesRepo({ brand: { id: 'acme' } }), { owner: '', name: 'acme-releases', repo: '' });
  assert.deepEqual(releasesRepo({ repo: { providers: { github: { org: 'Acme-Org' } } } }), { owner: 'Acme-Org', name: '', repo: '' });
  assert.deepEqual(releasesRepo({}), { owner: '', name: '', repo: '' });
});

test('parseRepoSlug: shapes', () => {
  assert.deepEqual(parseRepoSlug('owner/name'), { owner: 'owner', name: 'name' });
  assert.deepEqual(parseRepoSlug('bare'), { owner: '', name: 'bare' });
  assert.deepEqual(parseRepoSlug('  owner/name  '), { owner: 'owner', name: 'name' });
  assert.deepEqual(parseRepoSlug(''), { owner: '', name: '' });
  assert.deepEqual(parseRepoSlug(undefined), { owner: '', name: '' });
});
