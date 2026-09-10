// Unit tests for src/test/define-cases.js — the guard that stops a case file
// from reporting a hollow `pass 1` under bare `node --test`
// ([#630](https://github.com/Omega-JS-Stack/omega/issues/630)).
//
// `node --test <case-file>` only LOADS the module: no case body runs, yet the
// runner prints one passing "test" (the file). defineCases() makes that load
// THROW, naming the OMEGA runner, while the real lane keeps getting the spec
// back untouched.
//
// Both halves are proved for real: a spawned `node --test` on a fixture case
// file (the trap), and an in-process createRunner() run over the same wrapped
// shape (the lane) — this very file runs under `node --test`, so the lane half
// also proves the runner's own opt-out works.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const defineCases = require('../src/test/define-cases');
const { createRunner } = require('../src/test/runner-core');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Write a fixture tree: { 'relative/path.js': 'contents' } → root dir.
function makeTree(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

// A wrapped case file, written exactly as the codemod writes one: the bare
// package specifier, resolved through the workspace link.
const WRAPPED_CASE = `const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  description: 'fixture cases',
  tests: [
    { name: 'runs under the OMEGA runner', run: (ctx) => ctx.expect(1).toBe(1) },
  ],
});
`;

async function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

async function quiet(fn) {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

test('a wrapped case file under bare `node --test` fails loudly instead of passing hollow', () => {
  const root = makeTree('define-cases-bare', { 'cases/fixture.test.js': WRAPPED_CASE });
  const file = path.join(root, 'cases', 'fixture.test.js');

  // A CLEAN bare invocation: this process is itself under node --test, and both
  // signals are inherited — NODE_TEST_CONTEXT would make the child think it is a
  // recursive run, and a leaked OMEGA_CASE_RUNNER would hand it the opt-out.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env[defineCases.RUNNER_ENV];

  const result = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', cwd: root, env });
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  assert.notEqual(result.status, 0, `bare node --test must fail, got:\n${output}`);
  assert.match(output, /npx omega test/, 'the failure names the runner that actually runs the cases');
  assert.match(output, /cases[/\\]fixture\.test/, 'the failure names the file that did not run');
  assert.doesNotMatch(output, /^# fail 0$/m, 'the run must not report a hollow green');

  fs.rmSync(root, { recursive: true, force: true });
});

test('the OMEGA runner still runs a wrapped case file (this process is under node --test)', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'precondition: the guard signal is set in this process');

  const root = makeTree('define-cases-lane', {
    'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
    'consumer/test/wrapped.js': WRAPPED_CASE,
  });

  const runner = createRunner({
    title: 'Fixture Framework Tests',
    packageName: 'fixture-framework',
    targetAlias: 'fix',
    suitesDir: path.join(root, 'framework', 'suites'),
    frameworkTestDir: path.join(root, 'framework', 'test'),
    middleLayers: [],
    boot: { run: async () => {} },
  });

  const result = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

  assert.equal(result.passed, 1);
  assert.equal(result.failed, 0);

  fs.rmSync(root, { recursive: true, force: true });
});

test('outside node --test the spec comes back untouched, object and array form alike', () => {
  const previous = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const spec = { type: 'suite', tests: [{ name: 'a', run: () => {} }] };
    assert.equal(defineCases(spec), spec);

    const array = [{ name: 'a', run: () => {} }];
    assert.equal(defineCases(array), array);
  } finally {
    if (previous !== undefined) process.env.NODE_TEST_CONTEXT = previous;
  }
});

test('markRunnerActive() is what the runners set, and it survives into child processes', () => {
  const previous = process.env[defineCases.RUNNER_ENV];
  delete process.env[defineCases.RUNNER_ENV];
  try {
    defineCases.markRunnerActive();
    assert.equal(process.env[defineCases.RUNNER_ENV], 'true');

    // env, not a module flag: the desktop/extension lanes load case files in
    // spawned children (Electron), which inherit the parent's environment.
    const spec = {};
    assert.equal(defineCases(spec), spec);
  } finally {
    if (previous === undefined) delete process.env[defineCases.RUNNER_ENV];
    else process.env[defineCases.RUNNER_ENV] = previous;
  }
});
