/**
 * `--isolation=process`: each suite file in its own child, read back through
 * the same json report, filter, init hooks and log tee as the one-process run.
 */
const fs = require('node:fs');
const defineCases = require('../../src/test/define-cases.js');
const { runCli, tempPath, removeAll, takeFile, names } = require('./_fixtures/helpers.js');

const PROCESS = '--isolation=process';

// The pids a fixture recorded that are not the cli's own.
function childPids(text, cliPid) {
  return (text || '').split('\n').filter((pid) => pid && pid !== String(cliPid));
}

// The parts of a json report two isolation modes must share: its keys, counts and each entry's keys.
function shapeOf(json) {
  return {
    keys: Object.keys(json).sort(),
    counts: { passed: json.passed, failed: json.failed, skipped: json.skipped, tests: json.tests.length },
    entries: json.tests.map((t) => Object.keys(t).sort().join(',')).sort(),
    names: json.tests.map((t) => t.name).sort(),
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'isolation',
  tests: [
    {
      name: 'case-91 under process each suite file runs in its own child, with the same report as under none',
      run(ctx) {
        const out = tempPath('iso-pids.txt');
        const isolated = runCli('pids', [PROCESS], { env: { FIXTURE_OUT: out } });
        removeAll(isolated.log);
        const pids = (takeFile(out) || '').trim().split('\n').filter(Boolean);

        ctx.expect(isolated.json, isolated.output).not.toBeNull();
        ctx.expect(pids.length, `two pids recorded: ${pids}`).toBe(2);
        ctx.expect(pids[0], 'the two files ran in different processes').not.toBe(pids[1]);
        ctx.expect(pids, 'no file ran in the cli process').not.toContain(String(isolated.pid));

        const sharedOut = tempPath('none-pids.txt');
        const shared = runCli('pids', ['--isolation=none'], { env: { FIXTURE_OUT: sharedOut } });
        removeAll(shared.log, sharedOut);
        ctx.expect(shared.json, shared.output).not.toBeNull();
        ctx.expect(shapeOf(isolated.json)).toEqual(shapeOf(shared.json));
        ctx.expect(isolated.status).toBe(0);
      },
    },
    {
      name: 'case-92 under process a string a case writes to stdout stays out of the json report',
      run(ctx) {
        const out = tempPath('iso-stdout.txt');
        const run = runCli('iso-output', [PROCESS], { env: { FIXTURE_OUT: out } });
        removeAll(run.log);

        ctx.expect(run.json, `stdout is not one JSON document:\n${run.stdout}`).not.toBeNull();
        ctx.expect(run.json.passed).toBe(1);
        ctx.expect(run.stdout).not.toContain('ISO STDOUT LINE');
        ctx.expect(childPids(takeFile(out), run.pid), 'the case ran in a child').toHaveProperty('length', 1);
      },
    },
    {
      name: 'case-93 under process --filter runs only the cases whose name contains the text',
      run(ctx) {
        const out = tempPath('iso-filter.txt');
        const run = runCli('pids', [PROCESS, '--filter=two'], { env: { FIXTURE_OUT: out } });
        removeAll(run.log);

        ctx.expect(run.json, run.output).not.toBeNull();
        ctx.expect(names(run.json)).toEqual(['records pid two']);
        ctx.expect(childPids(takeFile(out), run.pid), 'one case ran, in a child').toHaveProperty('length', 1);
        ctx.expect(run.status).toBe(0);
      },
    },
    {
      name: 'case-94 under process a failing _init.js runs no case, names the file, and exits 1',
      run(ctx) {
        const out = tempPath('iso-init-fail.txt');
        const run = runCli('init-fail', [PROCESS], { env: { FIXTURE_OUT: out } });
        removeAll(run.log);

        ctx.expect(takeFile(out), 'the case body never ran').toBeNull();
        ctx.expect(run.output).toContain('_init.js');
        ctx.expect(run.status).toBe(1);
      },
    },
    {
      name: 'case-95 under process a line a case writes to stderr reaches the --log file',
      run(ctx) {
        const log = tempPath('iso-tee.log');
        const out = tempPath('iso-stderr.txt');
        // The tee is skipped under CI by design, so this child runs as a local one.
        const env = { FIXTURE_OUT: out, CI: undefined, GITHUB_ACTIONS: undefined };
        try {
          const run = runCli('iso-output', [PROCESS], { reporter: 'pretty', env, log });
          const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
          ctx.expect(text, run.output).toContain('ISO STDERR LINE');
          ctx.expect(childPids(takeFile(out), run.pid), 'the case ran in a child').toHaveProperty('length', 1);
        } finally {
          removeAll(log, out);
        }
      },
    },
    {
      name: 'case-115 under process an error a case throws after it settled fails its file entry and reaches the --log file',
      run(ctx) {
        const log = tempPath('iso-late.log');
        // The tee is skipped under CI by design, so this child runs as a local one.
        const env = { CI: undefined, GITHUB_ACTIONS: undefined };
        try {
          const run = runCli('iso-late', [PROCESS], { env, log });
          ctx.expect(run.json, run.output).not.toBeNull();
          ctx.expect(run.json.failed).toBeGreaterThanOrEqual(1);
          // Node marks the case itself passed, so the failure rides the file's own entry.
          const entry = run.json.tests.find((t) => t.status === 'fail' && t.file.endsWith('late.test.js')
            && t.error && t.error.message.includes('after its cases reported'));
          ctx.expect(entry, JSON.stringify(run.json.tests, null, 2)).toBeDefined();
          ctx.expect(entry.error.message).toContain('late boom');
          ctx.expect(run.status).toBe(1);
          ctx.expect(takeFile(log) || '', 'the log holds the late error').toContain('late boom');
        } finally {
          removeAll(log);
        }
      },
    },
    {
      name: 'case-96 an unknown --isolation value exits 1 naming none and process',
      run(ctx) {
        const run = runCli('basic', ['--isolation=bogus']);
        removeAll(run.log);

        ctx.expect(run.status, run.output).toBe(1);
        ctx.expect(run.output).toMatch(/\bnone\b[^\n]*\bprocess\b|\bprocess\b[^\n]*\bnone\b/);
      },
    },
  ],
});
