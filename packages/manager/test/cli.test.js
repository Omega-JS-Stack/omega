/**
 * CLI verb contract (#229) — `omega manage` is the ONE name for the service
 * walk, and a bare `omega` prints help and touches nothing. The walk command
 * module is stubbed before cli.js resolves it, so "did the bare invocation
 * walk this brand?" is observable in-process without running anything.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const managePath = require.resolve('../src/commands/manage.js');
const manageCalls = [];
require.cache[managePath] = {
  id: managePath,
  filename: managePath,
  path: path.dirname(managePath),
  loaded: true,
  exports: async (options) => {
    manageCalls.push(options);
  },
};

const Main = require('../src/cli.js');

/** Run fn with console.log captured; returns the joined lines. */
async function captureLogAsync(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

test('cli: a bare omega prints help and runs NOTHING — no walk, no writes', async () => {
  manageCalls.length = 0;
  const priorExitCode = process.exitCode;

  const text = await captureLogAsync(() => new Main({}).process({ _: [] }));

  assert.equal(manageCalls.length, 0, 'a bare CLI must never reconcile a brand behind the operator');
  assert.match(text, /Usage/);
  assert.notEqual(process.exitCode, 1, 'printing help is a success');
  process.exitCode = priorExitCode;
});

test('cli: the help names the three verbs and the fresh-brand path', async () => {
  const text = await captureLogAsync(() => new Main({}).process({ _: [] }));

  assert.match(text, /omega manage/, 'the walk verb');
  assert.match(text, /omega dev/, 'the dev stack');
  assert.match(text, /omega deploy/, 'the publish verb');
  assert.match(text, /omega onboard/, 'and how a stranger starts a brand at all');
});

test('cli: omega manage runs the walk, with its flags intact', async () => {
  manageCalls.length = 0;

  await new Main({}).process({ _: ['manage'], service: 'assets', dryRun: true });

  assert.equal(manageCalls.length, 1);
  assert.equal(manageCalls[0].service, 'assets', '--service reaches the walk');
  assert.equal(manageCalls[0].dryRun, true);
});

test('cli: the walk answers to ONE name — the old positional aliases are gone', async () => {
  manageCalls.length = 0;
  const priorExitCode = process.exitCode;

  await captureLogAsync(() => new Main({}).process({ _: [] , m: true }));
  await captureLogAsync(() => new Main({}).process({ _: ['run'] }));

  assert.equal(manageCalls.length, 0, '`-m` and `run` no longer walk anything');
  process.exitCode = priorExitCode;
});
