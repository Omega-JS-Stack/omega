/**
 * `omega deploy --direct` plan tests — the pure repo/domain derivation
 * (shared @omega.js/config brandRepoName: github.repo → repo_website →
 * brand.id; cname from brand.url's host). The build+push path is exercised
 * live against the playground via the manager's pipeline command, not here.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildDirectPlan, pagesHost } = require('../src/commands/deploy.js');

test('pagesHost: bare host from brand.url; empty when unset (feeds plan cname + build CNAME emission)', () => {
  assert.equal(pagesHost({ brand: { url: 'https://www.example.com/landing' } }), 'www.example.com');
  assert.equal(pagesHost({ brand: { url: 'http://omegajs.dev' } }), 'omegajs.dev');
  assert.equal(pagesHost({ brand: {} }), '');
  assert.equal(pagesHost({}), '');
});

test('direct plan: org + explicit repo + cname from brand.url host', () => {
  const plan = buildDirectPlan({
    github: { org: 'Org', repo: 'site' },
    brand: { id: 'b', url: 'https://www.example.com/landing' },
  });
  assert.equal(plan.repo, 'Org/site');
  assert.equal(plan.pushUrl, 'https://github.com/Org/site.git');
  assert.equal(plan.branch, 'gh-pages');
  assert.equal(plan.cname, 'www.example.com');
});

test('direct plan: repo_website names the repo when github.repo is unset (launch-night collision fix)', () => {
  const plan = buildDirectPlan({
    github: { org: 'Omega-JS-Stack', repo_website: 'https://github.com/Omega-JS-Stack/omegajs.dev' },
    brand: { id: 'omega', url: 'https://omegajs.dev' },
  });
  assert.equal(plan.repo, 'Omega-JS-Stack/omegajs.dev');
  assert.equal(plan.pushUrl, 'https://github.com/Omega-JS-Stack/omegajs.dev.git');
});

test('direct plan: owner + name both derive from repo_website (ITW-housed site repo, org still the brand org)', () => {
  const plan = buildDirectPlan({
    github: { org: 'Omega-JS-Stack', repo_website: 'https://github.com/ITW-Creative-Works/omegajs.dev' },
    brand: { id: 'omega', url: 'https://omegajs.dev' },
  });
  assert.equal(plan.repo, 'ITW-Creative-Works/omegajs.dev');
});

test('direct plan: repo defaults to brand.id when neither repo nor repo_website is set', () => {
  const plan = buildDirectPlan({ github: { org: 'Org' }, brand: { id: 'my-brand', url: 'https://my.brand' } });
  assert.equal(plan.repo, 'Org/my-brand');
});

test('direct plan: missing org / repo name / url each refuse with an instruction', () => {
  assert.throws(() => buildDirectPlan({ brand: { id: 'b', url: 'https://x.y' } }), /github\.org/);
  assert.throws(() => buildDirectPlan({ github: { org: 'O' }, brand: { url: 'https://x.y' } }), /github\.repo, github\.repo_website, or brand\.id/);
  assert.throws(() => buildDirectPlan({ github: { org: 'O' }, brand: { id: 'b' } }), /brand\.url/);
});
