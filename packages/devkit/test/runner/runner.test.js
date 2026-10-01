/**
 * createRunner with drivers: app rows reporting by id, host rows handing out
 * ctx extras, the row filter, opt-in lanes and the default layer. Each run is
 * one scenario of _fixtures/drive-runner.js in its own process.
 */
const defineCases = require('../../src/test/define-cases.js');
const { runScenario, failureOf, names } = require('./_fixtures/helpers.js');

const IN_APP_STACK = 'AssertionError: in-app failure\n    at inApp (background.js:7:3)';

const byName = (result, name) => result.tests.find((t) => t.name === name);

module.exports = defineCases({
  type: 'group',
  description: 'createRunner and drivers',
  tests: [
    {
      name: 'case-61 an app row driver reports pass, fail with its stack, and skip by id',
      run(ctx) {
        const { result, error, output } = runScenario('app-reports');

        ctx.expect(error, output).toBeNull();
        ctx.expect(result.passed).toBe(1);
        ctx.expect(result.failed).toBe(1);
        ctx.expect(result.skipped).toBe(1);
        ctx.expect(byName(result, 'reports pass')).toHaveProperty('status', 'pass');
        ctx.expect(byName(result, 'reports skip')).toHaveProperty('status', 'skip');
        const failure = byName(result, 'reports fail');
        ctx.expect(failure).toHaveProperty('status', 'fail');
        ctx.expect(failure).toHaveProperty('layer', 'background');
        ctx.expect(failure.error.stack).toBe(IN_APP_STACK);
      },
    },
    {
      name: 'case-62 an app case that never reports fails once the layer ends',
      run(ctx) {
        const { result, error, output } = runScenario('app-unreported');

        ctx.expect(error, output).toBeNull();
        ctx.expect(byName(result, 'reports pass')).toHaveProperty('status', 'pass');
        for (const name of ['reports fail', 'reports skip']) {
          const test = byName(result, name);
          ctx.expect(test, name).toHaveProperty('status', 'fail');
          ctx.expect(test.error.message, name).toContain('the background layer ended before this case reported');
        }
      },
    },
    {
      name: 'case-63 a host row case gets the extras its driver returned, and stop runs once after the last case',
      run(ctx) {
        const { result, error, calls, output } = runScenario('host-extras');

        ctx.expect(error, output).toBeNull();
        ctx.expect(result.failed, JSON.stringify(result.tests)).toBe(0);
        ctx.expect(result.passed).toBe(2);
        ctx.expect(calls.filter((call) => call === 'stop')).toEqual(['stop']);
        const stopAt = calls.indexOf('stop');
        ctx.expect(calls.indexOf('case:first host case')).toBeLessThan(stopAt);
        ctx.expect(calls.indexOf('case:second host case')).toBeGreaterThan(-1);
        ctx.expect(calls.indexOf('case:second host case')).toBeLessThan(stopAt);
      },
    },
    {
      name: 'case-64 a row that needs a driver and has none fails the run naming the layer',
      run(ctx) {
        const scenario = runScenario('no-driver');
        const { failed, text } = failureOf(scenario);

        ctx.expect(failed, scenario.output).toBe(true);
        ctx.expect(text).toContain('background');
      },
    },
    {
      name: 'case-65 --layer runs one row, and an unknown name fails listing the rows',
      run(ctx) {
        const one = runScenario('layer', 'build');
        ctx.expect(one.error, one.output).toBeNull();
        ctx.expect(names(one.result)).toEqual(['build case']);
        ctx.expect(one.result.tests[0]).toHaveProperty('status', 'pass');
        ctx.expect(one.calls, 'the main row driver never started').not.toContain('start');

        const unknown = runScenario('layer', 'nope');
        const { failed, text } = failureOf(unknown);
        ctx.expect(failed, unknown.output).toBe(true);
        for (const row of ['build', 'main', 'renderer', 'boot']) {
          ctx.expect(text, `names the ${row} row`).toContain(row);
        }
      },
    },
    {
      name: 'case-66 a lane directory is skipped by default and runs under --lane',
      run(ctx) {
        const plain = runScenario('lanes');
        ctx.expect(plain.error, plain.output).toBeNull();
        ctx.expect(names(plain.result)).toEqual(['plain case']);

        const lane = runScenario('lanes', 'live');
        ctx.expect(lane.error, lane.output).toBeNull();
        ctx.expect(names(lane.result)).toContain('live case');
      },
    },
    {
      name: 'case-67 a suite naming no layer runs on the framework default layer',
      run(ctx) {
        const { result, error, output } = runScenario('default-layer');

        ctx.expect(error, output).toBeNull();
        ctx.expect(result.tests.length).toBe(1);
        ctx.expect(result.tests[0]).toHaveProperty('layer', 'build');
        ctx.expect(result.tests[0]).toHaveProperty('status', 'pass');
      },
    },
  ],
});
