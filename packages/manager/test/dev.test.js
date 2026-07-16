// `omega dev` (brand root) — target-selection rules. The spawn plumbing is
// composition of tested pieces (discoverApps, resolveAppNode, watch-all's
// forwarding pattern); the SELECTION is the behavior with rules worth
// pinning: default set, --only/--except/--all, unknowns, missing apps,
// backend-first ordering.
const test = require('node:test');
const assert = require('node:assert');

const { selectDevTargets, DEFAULT_TARGETS } = require('../src/commands/dev.js');

const ALL_APPS = ['web', 'backend', 'desktop', 'extension'];

test('default set is the local web loop — web + backend, GUI targets stay down', () => {
  const { selected, unknown, missing } = selectDevTargets({ available: ALL_APPS });

  assert.deepStrictEqual(selected, ['backend', 'web'], 'backend boots first (publishes the port map)');
  assert.deepStrictEqual(DEFAULT_TARGETS, ['web', 'backend']);
  assert.deepStrictEqual(unknown, []);
  assert.deepStrictEqual(missing, []);
});

test('--only is the exact set; --except subtracts; --all boots every leg', () => {
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_APPS, only: 'web' }).selected,
    ['web'],
  );
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_APPS, only: 'desktop,web' }).selected,
    ['desktop', 'web'],
    '--only can opt GUI targets in',
  );
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_APPS, except: 'backend' }).selected,
    ['web'],
  );
  assert.deepStrictEqual(
    selectDevTargets({ available: ALL_APPS, all: true }).selected,
    ['backend', 'web', 'desktop', 'extension'],
    'backend still first under --all',
  );
});

test('unknown targets are reported, not booted; targets without apps go to missing', () => {
  const result = selectDevTargets({ available: ['web'], only: 'web,backend,mobile' });

  assert.deepStrictEqual(result.selected, ['web']);
  assert.deepStrictEqual(result.unknown, ['mobile'], 'no mobile dev leg exists (MAM parked)');
  assert.deepStrictEqual(result.missing, ['backend'], 'requested but no app in this brand');
});

test('a web-only brand defaults to just web — no phantom backend leg', () => {
  const { selected, missing } = selectDevTargets({ available: ['web'] });

  assert.deepStrictEqual(selected, ['web']);
  assert.deepStrictEqual(missing, [], 'the default set adapts to the brand instead of warning');
});
