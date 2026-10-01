/**
 * defineCases outside the runner: a suite file run by `node --test <file>` or
 * `node <file>` registers its own cases, a row that needs a driver fails
 * naming `npx omega test`, and with the runner active it only hands back the spec.
 */
const fs = require('node:fs');
const defineCases = require('../../src/test/define-cases.js');
const { runNode, tempPath, removeAll } = require('./_fixtures/helpers.js');

const MIXED = 'test/mixed.test.js';

module.exports = defineCases({
  type: 'group',
  description: 'defineCases outside the runner',
  tests: [
    {
      name: 'case-37 node --test on a node-framework suite runs its cases',
      run(ctx) {
        const marker = tempPath('bare-test.txt');
        const run = runNode('bare-node', ['--test', '--test-reporter=tap', MIXED], { env: { FIXTURE_OUT: marker } });
        const ran = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
        removeAll(marker);

        ctx.expect(ran, 'the passing case body ran').toBe('passing case ran\n');
        ctx.expect(run.output).toMatch(/^# pass [1-9]/m);
        ctx.expect(run.output).toMatch(/^# fail [1-9]/m);
        ctx.expect(run.status, 'a failing case makes the process exit non-zero').not.toBe(0);
      },
    },
    {
      name: 'case-38 node <file> on the same suite runs its cases too',
      run(ctx) {
        const marker = tempPath('bare-direct.txt');
        const run = runNode('bare-node', [MIXED], { env: { FIXTURE_OUT: marker } });
        const ran = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
        removeAll(marker);

        ctx.expect(ran, 'the passing case body ran').toBe('passing case ran\n');
        ctx.expect(run.output).toContain('bare failing case');
        ctx.expect(run.status, 'a failing case makes the process exit non-zero').not.toBe(0);
      },
    },
    {
      name: 'case-39 node --test on a row that needs a driver fails naming npx omega test',
      run(ctx) {
        const run = runNode('bare-backend', ['--test', 'test/needs-driver.test.js']);

        ctx.expect(run.status).not.toBe(0);
        ctx.expect(run.output).toContain('npx omega test');
      },
    },
    {
      name: 'case-39 node --test in a brand target that depends on a driver framework fails naming npx omega test',
      run(ctx) {
        const run = runNode('bare-target', ['--test', 'test/needs-driver.test.js']);

        ctx.expect(run.status).not.toBe(0);
        ctx.expect(run.output).toContain('npx omega test');
      },
    },
    {
      name: 'case-39 node --test on a non-framework @omega.js package runs as node whatever it depends on',
      run(ctx) {
        const marker = tempPath('scoped-lib.txt');
        const run = runNode('scoped-lib', ['--test', 'test/lib.test.js'], { env: { FIXTURE_OUT: marker } });
        const ran = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
        removeAll(marker);

        ctx.expect(ran, `the case body ran:\n${run.output}`).toBe('library case ran\n');
        ctx.expect(run.status, run.output).toBe(0);
      },
    },
    {
      name: 'case-40 with the runner active defineCases returns the spec and registers nothing',
      run(ctx) {
        const run = runNode('runner-active', ['test/active.test.js'], { env: { OMEGA_CASE_RUNNER: 'true' } });

        ctx.expect(run.stdout).toContain('returned:same');
        ctx.expect(run.output, 'no case was registered or run').not.toContain('must never register');
        ctx.expect(run.status).toBe(0);
      },
    },
  ],
});
