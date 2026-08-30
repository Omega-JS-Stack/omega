/**
 * Unit tests for src/deploy-precheck.js — the shared runner behind every
 * framework's `omega deploy` network precheck
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * The STEPS are each framework's; the guarantees tested here are the runner's:
 * the `--no-secrets` opt-out, list order, and a soft failure (a throwing step
 * warns and the run continues — a precheck reports, it never blocks a deploy).
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
