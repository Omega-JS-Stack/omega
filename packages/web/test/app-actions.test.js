/**
 * App-chrome action sizing + the topbar's own icon.
 *
 * #43: Liquid's `.size` on a hash is its KEY COUNT, not a missing property —
 * `{% if action.size %}` therefore fired for EVERY action and stamped a
 * `btn-<keycount>` class. The templates test the value explicitly now, so an
 * action with no size renders no size class at all.
 *
 * #3: the rail-collapse control asked for a `sidebar` icon the chain cannot
 * resolve; stock chrome must render a real SVG, never the tagged fallback.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite } = require('./lib/build.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'topbar-site');
const topbarData = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'site-data.json'), 'utf8'));

const buildApp = async () => {
  const pages = await buildSite(FIXTURE, topbarData, {}, 'app-actions-test');
  const app = pages.get('/app');
  assert.ok(app, 'app surface built');
  return app;
};

test('#43: an action with no size renders NO size class — the btn-<keycount> trap is gone', async () => {
  const app = await buildApp();

  assert.ok(!/\bbtn-\d/.test(app), 'no numeric btn-<N> class anywhere in the chrome');
  assert.ok(app.includes('Unsized action'), 'the topbar action rendered');
  assert.ok(app.includes('Unsized header action'), 'the page-header action rendered');
  assert.ok(app.includes('Unsized dropdown'), 'the topbar dropdown action rendered');
  assert.ok(app.includes('Unsized header dropdown'), 'the page-header dropdown action rendered');
});

test('#43: size: lg still renders btn-lg — and no longer collides with the btn-sm default', async () => {
  const app = await buildApp();

  const large = app.match(/<a class="([^"]*)" href="\/large"/g) || [];
  assert.equal(large.length, 2, 'both the topbar and the page-header large actions rendered');
  for (const anchor of large) {
    assert.match(anchor, /btn-lg/, 'the authored size lands as btn-lg');
    assert.ok(!/btn-sm/.test(anchor), 'the small default steps aside for an authored size');
  }

  const unsized = app.match(/<a class="([^"]*)" href="\/unsized"/g) || [];
  assert.equal(unsized.length, 2, 'both unsized actions rendered');
  for (const anchor of unsized) {
    assert.ok(!/btn-lg/.test(anchor), 'an unsized action never borrows a size');
  }
});

test('#3: the stock app chrome resolves every icon — no fallback triangle, no missing tag', async () => {
  const app = await buildApp();

  assert.ok(!app.includes('data-omega-icon-missing'), 'no icon fell through to the empty marker');
  assert.ok(app.includes('data-omega-fa="solid/table-columns"'), 'the rail-collapse toggle wears a resolvable icon');
  assert.ok(!app.includes('fa-sidebar'), 'the unresolvable name is gone');
});
