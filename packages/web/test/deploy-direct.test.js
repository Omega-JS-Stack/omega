/**
 * `omega deploy --direct` plan tests — the pure repo/domain derivation
 * (github service parity: org + repo || brand id; cname from brand.url's
 * host). The build+push path is exercised live against the playground via
 * the manager's pipeline command, not here.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildDirectPlan } = require('../src/commands/deploy.js');

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

test('direct plan: repo defaults to brand.id (github service derivation)', () => {
  const plan = buildDirectPlan({ github: { org: 'Org' }, brand: { id: 'my-brand', url: 'https://my.brand' } });
  assert.equal(plan.repo, 'Org/my-brand');
});

test('direct plan: missing org / repo name / url each refuse with an instruction', () => {
  assert.throws(() => buildDirectPlan({ brand: { id: 'b', url: 'https://x.y' } }), /github\.org/);
  assert.throws(() => buildDirectPlan({ github: { org: 'O' }, brand: { url: 'https://x.y' } }), /github\.repo or brand\.id/);
  assert.throws(() => buildDirectPlan({ github: { org: 'O' }, brand: { id: 'b' } }), /brand\.url/);
});
