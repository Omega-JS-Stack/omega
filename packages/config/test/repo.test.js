/**
 * brandRepoName/brandRepoOwner — the shared brand-repo derivation from the
 * optional `github.repo` slug ("owner/name" or bare name; name → brand.id,
 * owner → github.org). Born from the 2026-07-18 launch-night collision
 * (brand "omega" resolved to the framework MONOREPO); the `repoWebsite` URL
 * key is retired (2026-07-19).
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { parseRepoSlug, brandRepoName, brandRepoOwner } = require('../src/index.js');

test('brandRepoName: explicit owner/name slug names the repo', () => {
  assert.equal(
    brandRepoName({ github: { repo: 'itw-creative-works/omega-brand' }, brand: { id: 'omega' } }),
    'omega-brand',
  );
});

test('brandRepoName: bare-name slug wins over brand.id', () => {
  assert.equal(brandRepoName({ github: { repo: 'site' }, brand: { id: 'b' } }), 'site');
});

test('brandRepoName: brand.id fallback; empty when nothing resolves (the collision case needs the slug)', () => {
  assert.equal(brandRepoName({ github: {}, brand: { id: 'my-brand' } }), 'my-brand');
  assert.equal(brandRepoName({ brand: { id: 'my-brand' } }), 'my-brand');
  assert.equal(brandRepoName({}), '');
});

test('brandRepoOwner: slug owner wins (legacy orgWebsite — brand repo under the paid company org)', () => {
  assert.equal(
    brandRepoOwner({ github: { org: 'Omega-JS-Stack', repo: 'itw-creative-works/omega-brand' } }),
    'itw-creative-works',
  );
});

test('brandRepoOwner: bare-name slug falls to github.org; empty when nothing resolves', () => {
  assert.equal(brandRepoOwner({ github: { org: 'Org', repo: 'just-a-name' } }), 'Org');
  assert.equal(brandRepoOwner({ github: { org: 'Org' } }), 'Org');
  assert.equal(brandRepoOwner({}), '');
});

test('parseRepoSlug: shapes', () => {
  assert.deepEqual(parseRepoSlug('owner/name'), { owner: 'owner', name: 'name' });
  assert.deepEqual(parseRepoSlug('bare'), { owner: '', name: 'bare' });
  assert.deepEqual(parseRepoSlug('  owner/name  '), { owner: 'owner', name: 'name' });
  assert.deepEqual(parseRepoSlug(''), { owner: '', name: '' });
  assert.deepEqual(parseRepoSlug(undefined), { owner: '', name: '' });
});
