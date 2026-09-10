/**
 * `omega test` consumer-suite invocation (#114) — the default target must be a
 * glob node expands itself: a bare `test/` directory positional is treated as
 * a module to load on Node >= 22 (web's engines floor) and errors even when a
 * valid suite exists. Both invocations run FOR REAL against a staged app.
 * Run: node --test test/commands-test.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseTestScope, noMatchExitCode, NO_MATCH_EXIT_CODE, FANOUT_ENV } = require('@omega.js/devkit/test/scope');
const { projectTestArgs, frameworkTestRuns, selectedTestFiles } = require('../src/commands/test.js');

const stageTarget = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-commands-test-'));
  const passing = `const { test } = require('node:test');\ntest('passes', () => {});\n`;
  fs.mkdirSync(path.join(dir, 'test', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'top.test.js'), passing);
  fs.writeFileSync(path.join(dir, 'test', 'nested', 'deep.test.js'), passing);
  return dir;
};

// Strip the parent runner's NODE_TEST_* context vars — with them present the
// nested `node --test` behaves as the runner's IPC child and reports nothing.
const childEnv = () => Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST')),
);

const runSuite = (dir, target) => spawnSync(`node --test ${target}`, {
  cwd: dir, shell: true, encoding: 'utf8', env: childEnv(),
});

test('the default target discovers top-level and nested tests via node\'s own glob', () => {
  const dir = stageTarget();
  const result = runSuite(dir, projectTestArgs([]));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /pass 2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the old bare test/ positional fails on this Node — the defect stays pinned', () => {
  const dir = stageTarget();
  const result = runSuite(dir, 'test/');
  assert.notEqual(result.status, 0, 'bare test/ unexpectedly worked — revisit #114');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a project filter still maps to test/<path>* patterns', () => {
  assert.equal(projectTestArgs(['pages.js']), 'test/pages*');
  assert.equal(projectTestArgs(['a', 'b']), 'test/a* test/b*');
});

test('#344: `omega test web:` runs the watcher lane too, serially, and never in parallel', () => {
  // The framework suite is TWO phases here for the same reason the package's
  // own `npm test` is: a watcher suite left in the parallel glob starves.
  // `omega test web:` losing test/watch/ would silently stop running them.
  assert.deepEqual(frameworkTestRuns([]), [
    { flags: '', target: 'test/*.test.js' },
    { flags: '--test-concurrency=1 ', target: 'test/watch/*.test.js' },
  ]);

  // A filter reaches both dirs — a non-matching glob is a no-op run, so
  // `web:dev-watch` resolves in test/watch/ and `web:pricing` in test/.
  assert.deepEqual(frameworkTestRuns(['dev-watch']), [
    { flags: '', target: 'test/dev-watch*.test.js' },
    { flags: '--test-concurrency=1 ', target: 'test/watch/dev-watch*.test.js' },
  ]);
});

const stageFramework = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-commands-framework-'));
  const passing = `const { test } = require('node:test');\ntest('passes', () => {});\n`;
  fs.mkdirSync(path.join(dir, 'test', 'watch'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'pricing.test.js'), passing);
  fs.writeFileSync(path.join(dir, 'test', 'watch', 'dev-watch.test.js'), passing);
  return dir;
};

test('#814: a project filter resolves to the files it selects, so a typo is knowable', () => {
  const dir = stageTarget();
  const roots = { frameworkRoot: dir, projectRoot: dir };
  const scopeFor = (target) => parseTestScope([target], { frameworkAliases: ['web'] });

  assert.deepEqual(selectedTestFiles(scopeFor('top'), roots), ['test/top.test.js']);
  assert.deepEqual(selectedTestFiles(scopeFor('project:nested/deep'), roots), ['test/nested/deep.test.js']);
  assert.deepEqual(selectedTestFiles(scopeFor('topp'), roots), []);

  // A bare run names no file: the whole suite is the selection, never a typo.
  assert.ok(selectedTestFiles(scopeFor('project:'), roots).length >= 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('#814: a framework filter is selected across BOTH phases, not one at a time', () => {
  // `web:dev-watch` misses test/*.test.js and hits test/watch/*.test.js. Each
  // phase alone reads as a no-match; the union is what the run actually gets.
  const frameworkRoot = stageFramework();
  const roots = { frameworkRoot, projectRoot: stageTarget() };
  const scopeFor = (target) => parseTestScope([target], { frameworkAliases: ['web'] });

  assert.deepEqual(selectedTestFiles(scopeFor('web:dev-watch'), roots), ['test/watch/dev-watch.test.js']);
  assert.deepEqual(selectedTestFiles(scopeFor('web:pricing'), roots), ['test/pricing.test.js']);
  assert.deepEqual(selectedTestFiles(scopeFor('web:nope'), roots), []);

  // full: reaching ONE of the two sources is still a real selection.
  assert.deepEqual(selectedTestFiles(scopeFor('full:pricing'), roots), ['test/pricing.test.js']);
  assert.deepEqual(selectedTestFiles(scopeFor('full:top'), roots), ['test/top.test.js']);
  assert.deepEqual(selectedTestFiles(scopeFor('full:nope'), roots), []);

  fs.rmSync(roots.frameworkRoot, { recursive: true, force: true });
  fs.rmSync(roots.projectRoot, { recursive: true, force: true });
});

test('#814: a no-match exits 1 alone and with its own code inside a brand-root fan-out', () => {
  // `omega test` at a brand root forwards ONE target to every target, so a
  // target that does not carry it is a no-op there rather than a failure.
  assert.equal(FANOUT_ENV, 'OMEGA_TEST_FANOUT');
  assert.equal(NO_MATCH_EXIT_CODE, 3);
  assert.equal(noMatchExitCode({}), 1);
  assert.equal(noMatchExitCode({ OMEGA_TEST_FANOUT: '1' }), 3);
});
