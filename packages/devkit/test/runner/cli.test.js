/**
 * The runner end to end: `cli.js` driven on a fixture in a child process,
 * read through `--reporter=json` (or the pretty report), with its exit code.
 */
const fs = require('node:fs');
const defineCases = require('../../src/test/define-cases.js');
const { runCli, tempPath, removeAll, basenames, names } = require('./_fixtures/helpers.js');

const RUN_SHAPE_KEYS = ['durationMs', 'failed', 'noMatch', 'passed', 'skipped', 'tests'];
const TEST_SHAPE_KEYS = ['durationMs', 'file', 'id', 'layer', 'name', 'source', 'status', 'suite'];
const OPTIONAL_TEST_KEYS = ['reason', 'error'];
const ANSI = /\u001b\[[0-9;]*m/g;

// Read a temp output file a fixture wrote, then remove it.
function takeFile(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  removeAll(file);
  return text;
}

module.exports = defineCases({
  type: 'group',
  description: 'runner and cli',
  tests: [
    {
      name: 'case-47 discovery runs .test.js files and skips names starting with _',
      run(ctx) {
        const run = runCli('basic');
        removeAll(run.log);

        ctx.expect(run.json, run.output).not.toBeNull();
        ctx.expect(basenames(run.json)).toEqual(['a.test.js', 'b.test.js']);
        ctx.expect(names(run.json)).not.toContain('gamma case');
      },
    },
    {
      name: 'case-48 counts and exit code',
      run(ctx) {
        const run = runCli('counts');
        removeAll(run.log);

        ctx.expect(run.json, run.output).not.toBeNull();
        ctx.expect(run.json.passed).toBe(2);
        ctx.expect(run.json.failed).toBe(1);
        ctx.expect(run.json.skipped).toBe(1);
        ctx.expect(run.status).toBe(1);
      },
    },
    {
      name: 'case-49 an all-passing fixture exits 0',
      run(ctx) {
        const run = runCli('basic');
        removeAll(run.log);

        ctx.expect(run.json, run.output).not.toBeNull();
        ctx.expect(run.json.failed).toBe(0);
        ctx.expect(run.status).toBe(0);
      },
    },
    {
      name: 'case-50 every suite runs in the cli.js process',
      run(ctx) {
        const out = tempPath('pids.txt');
        const run = runCli('pids', [], { env: { FIXTURE_OUT: out } });
        removeAll(run.log);
        const pids = (takeFile(out) || '').trim().split('\n');

        ctx.expect(run.status, run.output).toBe(0);
        ctx.expect(pids).toEqual([String(run.pid), String(run.pid)]);
      },
    },
    {
      name: 'case-51 a path target runs that file only, and one matching nothing sets noMatch',
      run(ctx) {
        const hit = runCli('basic', ['sub/b.test.js']);
        removeAll(hit.log);
        ctx.expect(hit.json, hit.output).not.toBeNull();
        ctx.expect(basenames(hit.json)).toEqual(['b.test.js']);
        ctx.expect(hit.status).toBe(0);

        const miss = runCli('basic', ['nope/missing.test.js']);
        removeAll(miss.log);
        ctx.expect(miss.json, miss.output).not.toBeNull();
        ctx.expect(miss.json.noMatch).toBe('nope/missing.test.js');
        ctx.expect(miss.status).toBe(1);
      },
    },
    {
      name: 'case-52 --filter keeps cases whose name or suite description contains the text',
      run(ctx) {
        const byDescription = runCli('basic', ['--filter=second']);
        removeAll(byDescription.log);
        ctx.expect(byDescription.json, byDescription.output).not.toBeNull();
        ctx.expect(names(byDescription.json)).toEqual(['beta one', 'beta two']);

        const byName = runCli('basic', ['--filter=one']);
        removeAll(byName.log);
        ctx.expect(byName.json, byName.output).not.toBeNull();
        ctx.expect(names(byName.json)).toEqual(['beta one']);
      },
    },
    {
      name: 'case-53 a .test.js that exports no defineCases spec fails the run naming the file',
      run(ctx) {
        const run = runCli('not-a-spec');
        removeAll(run.log);

        ctx.expect(run.status).toBe(1);
        ctx.expect(run.output).toContain('plain.test.js');
      },
    },
    {
      name: 'case-54 a failing _init.js runs no case, names the file, and exits 1',
      run(ctx) {
        const out = tempPath('init-fail.txt');
        const run = runCli('init-fail', [], { env: { FIXTURE_OUT: out } });
        removeAll(run.log);

        ctx.expect(takeFile(out), 'the case body never ran').toBeNull();
        ctx.expect(run.json, run.output).not.toBeNull();
        ctx.expect(run.json.passed).toBe(0);
        ctx.expect(run.json.failed).toBeGreaterThanOrEqual(1);
        ctx.expect(run.output).toContain('_init.js');
        ctx.expect(run.status).toBe(1);
      },
    },
    {
      name: 'case-55 a passing _init.js runs its setup once before any case',
      run(ctx) {
        const out = tempPath('init-pass.txt');
        const run = runCli('init-pass', [], { env: { FIXTURE_OUT: out } });
        removeAll(run.log);
        const marker = takeFile(out);

        ctx.expect(run.json, run.output).not.toBeNull();
        ctx.expect(run.json.passed).toBe(2);
        ctx.expect(run.json.failed).toBe(0);
        ctx.expect(marker).toBe('setup\n');
      },
    },
    {
      name: 'case-56 --reporter=json writes one JSON document with the run() shape',
      run(ctx) {
        const run = runCli('counts');
        removeAll(run.log);

        ctx.expect(run.json, `stdout is not one JSON document:\n${run.stdout}`).not.toBeNull();
        ctx.expect(Object.keys(run.json).sort()).toEqual(RUN_SHAPE_KEYS);
        ctx.expect(run.json.tests.length).toBe(4);
        for (const test of run.json.tests) {
          const keys = Object.keys(test).filter((key) => !OPTIONAL_TEST_KEYS.includes(key)).sort();
          ctx.expect(keys, test.name).toEqual(TEST_SHAPE_KEYS);
        }
        const failure = run.json.tests.find((t) => t.status === 'fail');
        ctx.expect(failure.error.message).toContain('deliberate mismatch');
        const skipped = run.json.tests.find((t) => t.status === 'skip');
        ctx.expect(skipped).toHaveProperty('reason', 'later');
      },
    },
    {
      name: 'case-57 the pretty report has one Results block and the failure message under its line',
      run(ctx) {
        const run = runCli('counts', [], { reporter: 'pretty' });
        removeAll(run.log);
        const text = run.stdout.replace(ANSI, '');

        ctx.expect(text.match(/Results/g), text).toHaveProperty('length', 1);
        const results = text.indexOf('Results');
        ctx.expect(text.slice(results)).toMatch(/\b2 passing\b/);
        ctx.expect(text.slice(results)).toMatch(/\b1 failing\b/);
        ctx.expect(text.slice(results)).toMatch(/\b1 skipped\b/);
        ctx.expect(text.slice(results)).toMatch(/Total: 4 tests in \d+ms/);

        const failedLine = text.search(/✗[^\n]*fails on purpose/);
        ctx.expect(failedLine, text).toBeGreaterThan(-1);
        const message = text.indexOf('deliberate mismatch', failedLine);
        ctx.expect(message, 'the message sits under the failed line').toBeGreaterThan(failedLine);
        ctx.expect(message, 'and before the Results block').toBeLessThan(results);
      },
    },
    {
      name: 'case-58 --log holds the run output with no ANSI codes, replaced per run',
      run(ctx) {
        const log = tempPath('tee.log');
        // The tee is skipped under CI by design, so this child runs as a local one.
        const env = { FORCE_COLOR: '1', CI: undefined, GITHUB_ACTIONS: undefined };
        try {
          runCli('counts', [], { reporter: 'pretty', env, log });
          const first = fs.readFileSync(log, 'utf8');
          ctx.expect(first).toContain('fails on purpose');
          ctx.expect(first).not.toMatch(/\u001b\[/);

          runCli('basic', [], { reporter: 'pretty', env, log });
          const second = fs.readFileSync(log, 'utf8');
          ctx.expect(second).toContain('alpha case');
          ctx.expect(second, 'the second run replaced the first').not.toContain('fails on purpose');
        } finally {
          removeAll(log);
        }
      },
    },
    {
      name: 'case-59 --extended sets TEST_EXTENDED_MODE, and without it it is unset',
      run(ctx) {
        const extendedOut = tempPath('extended-on.json');
        const extended = runCli('extended', ['--extended'], { env: { FIXTURE_OUT: extendedOut } });
        removeAll(extended.log);
        const on = JSON.parse(takeFile(extendedOut) || '{}');
        ctx.expect(on.value, extended.output).toBeTruthy();

        const plainOut = tempPath('extended-off.json');
        const plain = runCli('extended', [], { env: { FIXTURE_OUT: plainOut } });
        removeAll(plain.log);
        const off = JSON.parse(takeFile(plainOut) || '{}');
        ctx.expect(off, plain.output).toEqual({ value: null });
      },
    },
    {
      name: 'case-60 a timer handle left open does not hold the process',
      run(ctx) {
        const run = runCli('open-handle');
        removeAll(run.log);

        ctx.expect(run.signal, 'the process ended by itself, not by the spawn timeout').toBeNull();
        ctx.expect(run.json, run.output).not.toBeNull();
        ctx.expect(run.json.passed).toBe(1);
        ctx.expect(run.status).toBe(0);
      },
    },
    {
      name: 'case-82 an error a passed case leaves behind fails the run',
      run(ctx) {
        const run = runCli('late-errors');
        removeAll(run.log);

        ctx.expect(run.json, run.output).not.toBeNull();
        ctx.expect(run.json.failed).toBeGreaterThanOrEqual(1);
        ctx.expect(run.stdout, 'the json report names the late error').toMatch(/late throw|late reject/);
        ctx.expect(run.status).toBe(1);
      },
    },
    {
      name: 'case-83 a case that calls process.exit ends the run non-zero, saying it ended before its report',
      run(ctx) {
        const run = runCli('early-exit');
        removeAll(run.log);

        ctx.expect(run.status, run.output).not.toBe(0);
        ctx.expect(run.stderr).toMatch(/before.*report/i);
      },
    },
    {
      name: 'case-84 a child writing to inherited stdout leaves the json report one clean document',
      run(ctx) {
        const run = runCli('child-output');
        removeAll(run.log);

        ctx.expect(run.json, `stdout is not one JSON document:\n${run.stdout}`).not.toBeNull();
        ctx.expect(run.json.passed).toBe(1);
        ctx.expect(run.stdout).not.toContain('CHILD OUTPUT');
      },
    },
  ],
});
