/**
 * `omega deploy --direct` plan tests — the pure repo/domain derivation
 * (shared @omega.js/config derivation from the repo.providers.github.repo
 * slug — name → brand.id, owner → repo.providers.github.org; cname from
 * brand.url's host). The build+push path is exercised
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
    repo: { providers: { github: { org: 'Org', repo: 'site' } } },
    brand: { id: 'b', url: 'https://www.example.com/landing' },
  });
  assert.equal(plan.repo, 'Org/site');
  assert.equal(plan.pushUrl, 'https://github.com/Org/site.git');
  assert.equal(plan.branch, 'gh-pages');
  assert.equal(plan.cname, 'www.example.com');
});

test('direct plan: bare-name slug names the repo (launch-night collision fix — never the monorepo)', () => {
  const plan = buildDirectPlan({
    repo: { providers: { github: { org: 'Omega-JS-Stack', repo: 'omega-brand' } } },
    brand: { id: 'omega', url: 'https://omegajs.dev' },
  });
  assert.equal(plan.repo, 'Omega-JS-Stack/omega-brand');
  assert.equal(plan.pushUrl, 'https://github.com/Omega-JS-Stack/omega-brand.git');
});

test('direct plan: owner/name slug carries both (ITW-housed brand repo, org still the brand org)', () => {
  const plan = buildDirectPlan({
    repo: { providers: { github: { org: 'Omega-JS-Stack', repo: 'itw-creative-works/omega-brand' } } },
    brand: { id: 'omega', url: 'https://omegajs.dev' },
  });
  assert.equal(plan.repo, 'itw-creative-works/omega-brand');
});

test('direct plan: repo defaults to brand.id when no slug is set', () => {
  const plan = buildDirectPlan({ repo: { providers: { github: { org: 'Org' } } }, brand: { id: 'my-brand', url: 'https://my.brand' } });
  assert.equal(plan.repo, 'Org/my-brand');
});

test('direct plan: missing org / repo name / url each refuse with an instruction', () => {
  assert.throws(() => buildDirectPlan({ brand: { id: 'b', url: 'https://x.y' } }), /repo\.providers\.github\.org/);
  assert.throws(() => buildDirectPlan({ repo: { providers: { github: { org: 'O' } } }, brand: { url: 'https://x.y' } }), /repo\.providers\.github\.repo or brand\.id/);
  assert.throws(() => buildDirectPlan({ repo: { providers: { github: { org: 'O' } } }, brand: { id: 'b' } }), /brand\.url/);
});
