/**
 * The json stdout guard and errors raised while a case runs, driven through
 * `cli.js` on a fixture in a child process.
 */
const defineCases = require('../../src/test/define-cases.js');
const { runCli, removeAll } = require('./_fixtures/helpers.js');

const byName = (json, name) => json.tests.find((t) => t.name === name);

module.exports = defineCases({
  type: 'group',
  description: 'stdout guard and in-case errors',
  tests: [
    {
      name: 'case-86 a runner started under an inherited NODE_TEST_CONTEXT still reports on stdout',
      run(ctx) {
        const env = { NODE_TEST_CONTEXT: 'child-v8' };

        const json = runCli('guard-context', [], { env });
        removeAll(json.log);
        ctx.expect(json.json, `stdout is not one JSON document:\n${json.output}`).not.toBeNull();
        ctx.expect(json.json.passed).toBe(1);

        const pretty = runCli('guard-context', [], { reporter: 'pretty', env });
        removeAll(pretty.log);
        ctx.expect(pretty.stdout, pretty.output).toContain('Results');
      },
    },
    {
      name: 'case-87 a Buffer a case writes to stdout stays out of the json report',
      run(ctx) {
        const run = runCli('guard-buffer');
        removeAll(run.log);

        ctx.expect(run.json, `stdout is not one JSON document:\n${run.stdout}`).not.toBeNull();
        ctx.expect(run.json.passed).toBe(1);
        ctx.expect(run.stdout).not.toContain('RAW BUFFER');
      },
    },
    {
      name: 'case-88 execSync and execFileSync children with inherited stdio stay out of the json report',
      run(ctx) {
        const run = runCli('guard-exec');
        removeAll(run.log);

        ctx.expect(run.json, `stdout is not one JSON document:\n${run.stdout}`).not.toBeNull();
        ctx.expect(run.json.passed).toBe(1);
        ctx.expect(run.stdout).not.toContain('EXECSYNC OUT');
        ctx.expect(run.stdout).not.toContain('EXECFILESYNC OUT');
      },
    },
    {
      name: 'case-89 an error raised while a case runs fails that case and adds no extra entry',
      run(ctx) {
        const run = runCli('during-errors');
        removeAll(run.log);

        ctx.expect(run.json, run.output).not.toBeNull();
        ctx.expect(run.json.tests.length, JSON.stringify(run.json.tests, null, 2)).toBe(2);
        ctx.expect(run.json.failed).toBe(2);
        const rejected = byName(run.json, 'rejects a promise nobody awaits');
        ctx.expect(rejected).toHaveProperty('status', 'fail');
        ctx.expect(rejected.error.message).toContain('during reject');
        const thrown = byName(run.json, 'throws from a timer while running');
        ctx.expect(thrown).toHaveProperty('status', 'fail');
        ctx.expect(thrown.error.message).toContain('during throw');
        ctx.expect(run.status).toBe(1);
      },
    },
  ],
});
