/**
 * When the runner loads a suite file: a one-row framework loads each file right
 * before its cases run, after the previous file's cleanup, and a framework with
 * several rows loads every file up front. Each run is one scenario of
 * _fixtures/drive-runner.js in its own process.
 */
const path = require('node:path');

const defineCases = require('../../src/test/define-cases.js');
const { runScenario, names } = require('./_fixtures/helpers.js');

const byName = (result, name) => result.tests.find((t) => t.name === name);

module.exports = defineCases({
  type: 'group',
  description: 'createRunner suite load order',
  tests: [
    {
      name: 'a one-row framework: a module one file mocks at load and restores in cleanup never reaches the next file',
      run(ctx) {
        const { result, error, output } = runScenario('one-row', 'lazy-load');

        ctx.expect(error, output).toBeNull();
        ctx.expect(byName(result, 'reads the real module'), JSON.stringify(result.tests)).toHaveProperty('status', 'pass');
        ctx.expect(result.passed).toBe(2);
        ctx.expect(result.failed).toBe(0);
      },
    },
    {
      name: 'a one-row framework: each file loads after the previous file has run its cases and its cleanup',
      run(ctx) {
        const { calls, error, output } = runScenario('one-row', 'lazy-load');

        ctx.expect(error, output).toBeNull();
        ctx.expect(calls).toEqual(['load A', 'case A', 'cleanup A', 'load B', 'case B']);
      },
    },
    {
      name: 'a one-row framework: a file that throws on load fails the run naming it, and the files around it still run',
      run(ctx) {
        const { result, error, output } = runScenario('one-row', 'lazy-throw');

        ctx.expect(error, output).toBeNull();
        ctx.expect(result.failed).toBe(1);
        const failure = result.tests.find((t) => t.status === 'fail');
        ctx.expect(path.basename(failure.file)).toBe('b.test.js');
        ctx.expect(failure.error.message).toContain('broken at load');
        ctx.expect(result.passed).toBe(3);
        for (const name of ['first good case', 'second good case', 'last good case']) {
          ctx.expect(byName(result, name), name).toHaveProperty('status', 'pass');
        }
      },
    },
    {
      name: 'a one-row framework: --filter on a suite description reports only that suite, its heading once',
      run(ctx) {
        const { result, error, output } = runScenario('one-row-filter', 'mocking suite');

        ctx.expect(error, output).toBeNull();
        ctx.expect(names(result)).toEqual(['mocking case']);
        ctx.expect(result.passed).toBe(1);
        ctx.expect(output.split('⤷ mocking suite').length - 1, output).toBe(1);
        ctx.expect(output).not.toContain('reading suite');
      },
    },
    {
      name: 'a framework with several rows loads every file before the first case runs',
      run(ctx) {
        const { result, calls, error, output } = runScenario('several-rows');

        ctx.expect(error, output).toBeNull();
        ctx.expect(result.passed).toBe(2);
        ctx.expect(calls).toEqual(['load A', 'load B', 'case A', 'case B']);
      },
    },
  ],
});
