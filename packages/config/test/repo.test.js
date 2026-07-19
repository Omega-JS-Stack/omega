/**
 * brandRepoName — the shared brand-repo derivation (github.repo →
 * repo_website URL → brand.id). Born from the 2026-07-18 launch-night
 * collision: brand id "omega" resolved to the framework MONOREPO
 * (Omega-JS-Stack/omega) instead of the brand repo (omegajs.dev).
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { brandRepoName, brandRepoOwner } = require('../src/index.js');

test('brandRepoName: explicit github.repo wins over everything', () => {
  assert.equal(
    brandRepoName({ github: { repo: 'site', repo_website: 'https://github.com/O/other' }, brand: { id: 'b' } }),
    'site',
  );
});

test('brandRepoName: repo_website URL names the repo (the launch-night collision case)', () => {
  assert.equal(
    brandRepoName({ github: { repo_website: 'https://github.com/Omega-JS-Stack/omegajs.dev' }, brand: { id: 'omega' } }),
    'omegajs.dev',
  );
  assert.equal(brandRepoName({ github: { repo_website: 'https://github.com/O/r.git' }, brand: { id: 'b' } }), 'r');
  assert.equal(brandRepoName({ github: { repo_website: 'https://github.com/O/r/' }, brand: { id: 'b' } }), 'r');
});

test('brandRepoName: brand.id fallback; empty when nothing resolves', () => {
  assert.equal(brandRepoName({ github: {}, brand: { id: 'my-brand' } }), 'my-brand');
  assert.equal(brandRepoName({ brand: { id: 'my-brand' } }), 'my-brand');
  assert.equal(brandRepoName({}), '');
});

test('brandRepoOwner: repo_website account wins (legacy orgWebsite — site repo under the paid company org)', () => {
  assert.equal(
    brandRepoOwner({ github: { org: 'Omega-JS-Stack', repo_website: 'https://github.com/ITW-Creative-Works/omegajs.dev' } }),
    'ITW-Creative-Works',
  );
});

test('brandRepoOwner: github.org fallback; empty when nothing resolves', () => {
  assert.equal(brandRepoOwner({ github: { org: 'Org' } }), 'Org');
  assert.equal(brandRepoOwner({ github: { org: 'Org', repo_website: 'not a url' } }), 'Org');
  assert.equal(brandRepoOwner({}), '');
});
