// Unit tests for src/test/runner-core.js — the shared framework test runner.
//
// Builds a real fixture "framework + consumer" tree under .temp/ and runs the core
// against it (process.cwd is temporarily pointed at the fixture consumer). No mocks —
// the fixture suites are real CommonJS modules the runner discovers and executes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRunner, SkipError, DISCOVERY_IGNORE, expect } = require('../src/test/runner-core');

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

// Run fn with process.cwd() pointed at dir (runner discovery is cwd-relative).
async function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

// Silence the runner's console output during a run; return captured lines.
async function quiet(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.log = original;
  }
}

function makeConfig(root, overrides) {
  return {
    title: 'Fixture Framework Tests',
    packageName: 'fixture-framework',
    targetAlias: 'fix',
    suitesDir: path.join(root, 'framework', 'suites'),
    frameworkTestDir: path.join(root, 'framework', 'test'),
    middleLayers: [],
    boot: { run: async () => {} },
    ...overrides,
  };
}

test('runs standalone, suite, group, and array-form build tests with correct counts', async () => {
  const root = makeTree('runner-basic', {
    'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
    'consumer/test/standalone.js': `module.exports = { description: 'standalone passes', run: (ctx) => ctx.expect(1).toBe(1) };`,
    'consumer/test/suite.js': `module.exports = { type: 'suite', description: 'a suite', tests: [
      { name: 'one', run: (ctx) => ctx.expect(true).toBeTruthy() },
      { name: 'two', run: (ctx) => { ctx.state.x = 5; } },
      { name: 'three', run: (ctx) => ctx.expect(ctx.state.x).toBe(5) },   // state carries across suite
    ]};`,
    'consumer/test/group.js': `module.exports = [
      { name: 'g1', run: () => {} },
      { name: 'g2', run: () => { throw new Error('g2 fails'); } },
      { name: 'g3', run: () => {} },                                      // groups keep going after failure
    ];`,
    'consumer/test/_helper.js': `throw new Error('underscore files must not be discovered');`,
    'consumer/test/_fixtures/nested.js': `throw new Error('underscore dirs must not be discovered');`,
  });

  const runner = createRunner(makeConfig(root));
  const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

  assert.equal(result.passed, 6);  // standalone + 3 suite + g1 + g3
  assert.equal(result.failed, 1);  // g2
  assert.equal(result.skipped, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('suites stop on first failure and skip the remainder; groups do not', async () => {
  const root = makeTree('runner-stop', {
    'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
    'consumer/test/suite.js': `module.exports = { type: 'suite', description: 'stops', tests: [
      { name: 'ok', run: () => {} },
      { name: 'boom', run: () => { throw new Error('boom'); } },
      { name: 'never-a', run: () => {} },
      { name: 'never-b', run: () => {} },
    ]};`,
  });

  const runner = createRunner(makeConfig(root));
  const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

  assert.equal(result.passed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 2); // never-a, never-b
  fs.rmSync(root, { recursive: true, force: true });
});

test('skip: static flags, runtime ctx.skip(), and SkipError all count as skipped', async () => {
  const root = makeTree('runner-skip', {
    'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
    'consumer/test/skips.js': `module.exports = { type: 'group', description: 'skips', tests: [
      { name: 'static', skip: 'not today', run: () => { throw new Error('must not run'); } },
      { name: 'runtime', run: (ctx) => ctx.skip('runtime reason') },
      { name: 'passes', run: () => {} },
    ]};`,
    'consumer/test/whole-file-skip.js': `module.exports = { description: 'whole file', skip: true, run: () => { throw new Error('no'); } };`,
  });

  const runner = createRunner(makeConfig(root));
  const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

  assert.equal(result.passed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 3); // static + runtime + whole-file
  fs.rmSync(root, { recursive: true, force: true });
});

test('filter narrows by test/suite name', async () => {
  const root = makeTree('runner-filter', {
    'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
    'consumer/test/mixed.js': `module.exports = { type: 'group', description: 'mixed', tests: [
      { name: 'alpha-match', run: () => {} },
      { name: 'beta-other', run: () => { throw new Error('should be filtered out'); } },
    ]};`,
  });

  const runner = createRunner(makeConfig(root));
  const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ filter: 'alpha' })));

  assert.equal(result.passed, 1);
  assert.equal(result.failed, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('middle layers dispatch with byLayer/wants; boot aggregates flat test list', async () => {
  const root = makeTree('runner-layers', {
    'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
    'consumer/test/a-page.js': `module.exports = { layer: 'page', description: 'page suite', tests: [ { name: 'p1', run: () => {} } ] };`,
    'consumer/test/b-boot.js': `module.exports = { layer: 'boot', description: 'boot suite', timeout: 12345, tests: [
      { description: 'boots', inspect: async () => {} },
      { description: 'boots deeper', timeout: 777, inspect: async () => {} },
    ]};`,
    'consumer/test/c-build.js': `module.exports = { description: 'plain build', run: () => {} };`,
  });

  const seen = { middle: null, boot: null };
  const runner = createRunner(makeConfig(root, {
    bootDefaultTimeout: 15000,
    middleLayers: [{
      layers: ['page'],
      run: async ({ byLayer, wants, results }) => {
        seen.middle = { files: byLayer.page.length, wants: { ...wants } };
        results.passed += 1; // simulate the framework runner reporting one pass
      },
    }],
    boot: {
      run: async ({ tests, results }) => {
        seen.boot = tests.map((t) => ({ description: t.description, timeout: t.timeout }));
        results.passed += tests.length;
      },
    },
  }));

  const { result } = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));

  assert.deepEqual(seen.middle, { files: 1, wants: { page: true } });
  assert.deepEqual(seen.boot, [
    { description: 'boots', timeout: 12345 },          // suite-level timeout inherited
    { description: 'boots deeper', timeout: 777 },     // test-level timeout wins
  ]);
  assert.equal(result.passed, 1 + 1 + 2); // build + middle + boot
  fs.rmSync(root, { recursive: true, force: true });
});

test('C5 scoping: bare = project only; framework:/alias:/full: select sources', async () => {
  const root = makeTree('runner-target', {
    'framework/suites/fw.js': `module.exports = { description: 'framework test', run: () => {} };`,
    'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
    'consumer/test/proj.js': `module.exports = { description: 'project test', run: () => {} };`,
  });

  const runner = createRunner(makeConfig(root));

  // Bare consumer run = PROJECT tests only (never drags the framework suite in).
  const bare = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run()));
  assert.equal(bare.result.passed, 1);

  const projectOnly = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target: 'project:' })));
  assert.equal(projectOnly.result.passed, 1);

  // 'brand:' is the explicit project alias.
  const brandAlias = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target: 'brand:' })));
  assert.equal(brandAlias.result.passed, 1);

  // The framework suite is an explicit choice: targetAlias ('fix:'), 'framework:', 'omega:'.
  for (const target of ['fix:', 'framework:', 'omega:']) {
    const frameworkOnly = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target })));
    assert.equal(frameworkOnly.result.passed, 1, target);
  }

  // 'full:' = both sources.
  const both = await quiet(() => withCwd(path.join(root, 'consumer'), () => runner.run({ target: 'full:' })));
  assert.equal(both.result.passed, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('framework boot/ suites are excluded for consumers but run in self-test mode', async () => {
  const root = makeTree('runner-selftest', {
    'framework/suites/build/ok.js': `module.exports = { description: 'fw build', run: () => {} };`,
    'framework/suites/boot/fixture.js': `module.exports = { layer: 'boot', description: 'fw boot', inspect: async () => {} };`,
    'consumer/package.json': JSON.stringify({ name: 'fixture-consumer' }),
    'selftest/package.json': JSON.stringify({ name: 'fixture-framework' }),
  });

  let bootCalls = 0;
  const config = makeConfig(root, {
    boot: { run: async ({ tests, results }) => { bootCalls += 1; results.passed += tests.length; } },
  });

  // Consumer running the framework suite explicitly (C5: bare no longer
  // reaches it): boot/ stays excluded from discovery entirely.
  const consumer = await quiet(() => withCwd(path.join(root, 'consumer'), () => createRunner(config).run({ target: 'framework:' })));
  assert.equal(consumer.result.passed, 1);
  assert.equal(bootCalls, 0);

  // Self-test (cwd package name === config.packageName): boot/ suite runs.
  const selftest = await quiet(() => withCwd(path.join(root, 'selftest'), () => createRunner(config).run()));
  assert.equal(selftest.result.passed, 2);
  assert.equal(bootCalls, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('exports SkipError, DISCOVERY_IGNORE, and the shared expect', () => {
  assert.equal(typeof SkipError, 'function');
  assert.ok(Array.isArray(DISCOVERY_IGNORE));
  assert.equal(typeof expect, 'function');
  assert.equal(expect, require('../src/test/assert.js'));
});
