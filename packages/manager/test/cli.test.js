/**
 * CLI verb contract (#229) — `omega manage` is the ONE name for the service
 * walk, and a bare `omega` prints help and touches nothing. The walk command
 * module is stubbed before cli.js resolves it, so "did the bare invocation
 * walk this brand?" is observable in-process without running anything.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'cli',
  tests: [
    {
      name: 'cli: a bare omega prints help and runs NOTHING — no walk, no writes',
      run: async (ctx) => {
        manageCalls.length = 0;
        const priorExitCode = process.exitCode;

        const text = await captureLogAsync(() => new Main({}).process({ _: [] }));

        ctx.expect(manageCalls.length, 'a bare CLI must never reconcile a brand behind the operator').toBe(0);
        ctx.expect(text).toMatch(/Usage/);
        ctx.expect(process.exitCode, 'printing help is a success').not.toBe(1);
        process.exitCode = priorExitCode;
      },
    },

    {
      name: 'cli: the help names the three verbs and the fresh-brand path',
      run: async (ctx) => {
        const text = await captureLogAsync(() => new Main({}).process({ _: [] }));

        ctx.expect(text, 'the walk verb').toMatch(/omega manage/);
        ctx.expect(text, 'the dev stack').toMatch(/omega dev/);
        ctx.expect(text, 'the publish verb').toMatch(/omega deploy/);
        ctx.expect(text, 'and how a stranger starts a brand at all').toMatch(/omega onboard/);
      },
    },

    {
      name: 'cli: omega manage runs the walk, with its flags intact',
      run: async (ctx) => {
        manageCalls.length = 0;

        await new Main({}).process({ _: ['manage'], service: 'assets', dryRun: true });

        ctx.expect(manageCalls.length).toBe(1);
        ctx.expect(manageCalls[0].service, '--service reaches the walk').toBe('assets');
        ctx.expect(manageCalls[0].dryRun).toBe(true);
      },
    },

    {
      name: 'cli: the walk answers to ONE name — the old positional aliases are gone',
      run: async (ctx) => {
        manageCalls.length = 0;
        const priorExitCode = process.exitCode;

        await captureLogAsync(() => new Main({}).process({ _: [] , m: true }));
        await captureLogAsync(() => new Main({}).process({ _: ['run'] }));

        ctx.expect(manageCalls.length, '`-m` and `run` no longer walk anything').toBe(0);
        process.exitCode = priorExitCode;
      },
    },
  ],
});
