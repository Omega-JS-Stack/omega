/**
 * brandRepoName/brandRepoOwner — the shared brand-repo derivation from the
 * optional `repo.providers.github.repo` slug ("owner/name" or bare name; name → brand.id,
 * owner → repo.providers.github.org). Born from the 2026-07-18 launch-night collision
 * (brand "omega" resolved to the framework MONOREPO); the `repoWebsite` URL
 * key is retired (2026-07-19).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { parseRepoSlug, brandRepoName, brandRepoOwner, loadConfig } = require('../src/index.js');

test('brandRepoName: explicit owner/name slug names the repo', () => {
  assert.equal(
    brandRepoName({ repo: { providers: { github: { repo: 'itw-creative-works/omega-brand' } } }, brand: { id: 'omega' } }),
    'omega-brand',
  );
});

test('brandRepoName: bare-name slug wins over brand.id', () => {
  assert.equal(brandRepoName({ repo: { providers: { github: { repo: 'site' } } }, brand: { id: 'b' } }), 'site');
});

test('brandRepoName: brand.id fallback; empty when nothing resolves (the collision case needs the slug)', () => {
  assert.equal(brandRepoName({ repo: { providers: { github: {} } }, brand: { id: 'my-brand' } }), 'my-brand');
  assert.equal(brandRepoName({ brand: { id: 'my-brand' } }), 'my-brand');
  assert.equal(brandRepoName({}), '');
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

test('parseRepoSlug: shapes', () => {
  assert.deepEqual(parseRepoSlug('owner/name'), { owner: 'owner', name: 'name' });
  assert.deepEqual(parseRepoSlug('bare'), { owner: '', name: 'bare' });
  assert.deepEqual(parseRepoSlug('  owner/name  '), { owner: 'owner', name: 'name' });
  assert.deepEqual(parseRepoSlug(''), { owner: '', name: '' });
  assert.deepEqual(parseRepoSlug(undefined), { owner: '', name: '' });
});
