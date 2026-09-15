/**
 * Unit tests for src/deploy-precheck.js — the shared runner behind every
 * framework's `omega deploy` network precheck
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * The STEPS are each framework's; the guarantees tested here are the runner's:
 * the `--no-secrets` opt-out, list order, a soft failure (a throwing step warns
 * and the run continues, because a precheck reports), a FATAL step that stops
 * the run instead ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)),
 * and the `dryRun` every step receives
 * ([#895](https://github.com/Omega-JS-Stack/omega/issues/895)).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { runDeployPrecheck } = require('../src/deploy-precheck');

function recorder() {
  const lines = { log: [], warn: [] };
  return {
    lines,
    logger: { log: (l) => lines.log.push(l), warn: (l) => lines.warn.push(l), error: (l) => lines.warn.push(l) },
  };
}

function steps(names, throwing) {
  const ran = [];
  return {
    ran,
    steps: names.map((name) => ({
      name,
      run: () => {
        if (name === throwing) throw new Error(`${name} exploded`);
        ran.push(name);
      },
    })),
  };
}

test('--no-secrets skips every step and returns the opt-out marker', async () => {
  const { logger, lines } = recorder();
  const { ran, steps: list } = steps(['a', 'b']);

  const result = await runDeployPrecheck({ projectDir: '/tmp/x', options: { secrets: false }, logger, steps: list });

  assert.deepEqual(result, { skipped: 'opt-out' });
  assert.deepEqual(ran, [], 'no step runs');
  assert.match(lines.log.join('\n'), /--no-secrets/, 'the opt-out is announced');
});

test('steps run in list order and `ran` names the ones that finished', async () => {
  const { logger } = recorder();
  const { ran, steps: list } = steps(['first', 'second', 'third']);

  const result = await runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list });

  assert.deepEqual(ran, ['first', 'second', 'third']);
  assert.deepEqual(result.ran, ran);
});

test('a throwing step is a warning, not a stop — a precheck reports', async () => {
  const { logger, lines } = recorder();
  const { ran, steps: list } = steps(['first', 'boom', 'third'], 'boom');

  const result = await runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list });

  assert.deepEqual(ran, ['first', 'third'], 'the run continues past the failure');
  assert.deepEqual(result.ran, ['first', 'third'], 'a failed step is not reported as run');
  assert.match(lines.warn.join('\n'), /boom failed during the deploy precheck \(non-fatal\): boom exploded/);
});

test('every step gets the projectDir and the two loggers', async () => {
  const { logger, lines } = recorder();
  const seen = [];
  const list = [{ name: 'probe', run: (input) => { seen.push(input); input.log('hi'); input.warn('careful'); } }];

  await runDeployPrecheck({ projectDir: '/tmp/target', options: {}, logger, steps: list });

  assert.equal(seen[0].projectDir, '/tmp/target');
  assert.deepEqual(lines.log, ['hi']);
  assert.deepEqual(lines.warn, ['careful']);
});

test('a FATAL step STOPS the run: the deploy never reaches its dispatch (#891)', async () => {
  const { logger } = recorder();
  const ran = [];
  const list = [
    { name: 'first', run: () => ran.push('first') },
    { name: 'push-secrets', fatal: true, run: () => { throw new Error('3 secret(s) are empty'); } },
    { name: 'third', run: () => ran.push('third') },
  ];

  await assert.rejects(
    () => runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list }),
    /push-secrets failed during the deploy precheck: 3 secret\(s\) are empty/,
  );

  assert.deepEqual(ran, ['first'], 'nothing after the fatal step runs');
});

test('dryRun reaches every step, and defaults to false (#895)', async () => {
  const { logger } = recorder();
  const seen = [];
  const list = [{ name: 'probe', run: ({ dryRun }) => seen.push(dryRun) }];

  await runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list, dryRun: true });
  await runDeployPrecheck({ projectDir: '/tmp/x', options: {}, logger, steps: list });

  assert.deepEqual(seen, [true, false]);
});
