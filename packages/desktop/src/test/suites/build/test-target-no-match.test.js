// Build-layer tests for the no-match rule ([#814](https://github.com/Omega-JS-Stack/omega/issues/814)).
//
// `npx omega test renderer/main-view` with no such file printed "No test files
// found.", "0 passing", and exited 0: a typo'd path target, or a suite renamed
// out from under one, ran silently green.
//
// The rule lives in the runner's selection step, so these drive the REAL
// desktop runner from a consumer directory with no tests of its own.

const fs = require('fs');
const os = require('os');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const RUNNER = path.join(__dirname, '..', '..', 'runner.js');

// A consumer directory with a package.json and no test/ dir at all.
function makeEmptyConsumer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-no-match-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'no-match-fixture' }));
  return dir;
}

// Run the real runner from `dir`, with its report silenced: the probe reports
// like any run, and its report is not THIS run's.
async function runFrom(dir, options) {
  const { run } = require(RUNNER);
  const previousCwd = process.cwd();
  const realLog = console.log;

  process.chdir(dir);
  console.log = () => {};

  try {
    return await run(options);
  } finally {
    console.log = realLog;
    process.chdir(previousCwd);
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'test targets that match nothing',
  tests: [
    {
      name: 'a named target that selects no file comes back flagged, not green',
      run: async (ctx) => {
        const dir = makeEmptyConsumer();

        try {
          // Every spelling of a path target: bare, framework-scoped, project-scoped.
          for (const target of ['renderer/does-not-exist', 'desktop:build/does-not-exist', 'project:does-not-exist']) {
            const result = await runFrom(dir, { target });
            ctx.expect(result.noMatch).toBe(target);
            ctx.expect(result.passed).toBe(0);
            ctx.expect(result.failed).toBe(0);
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a run that named no file stays green with nothing to run',
      run: async (ctx) => {
        const dir = makeEmptyConsumer();

        try {
          // A bare run, and a bare source prefix, ask for a source rather than
          // a file: an empty project is still an exit-0 run.
          for (const options of [{}, { target: 'project:' }]) {
            const result = await runFrom(dir, options);
            ctx.expect(result.noMatch).toBe(null);
            ctx.expect(result.passed).toBe(0);
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a target naming a real framework suite still selects it',
      run: async (ctx) => {
        const dir = makeEmptyConsumer();

        try {
          const result = await runFrom(dir, { target: 'desktop:build/test-discovery' });
          ctx.expect(result.noMatch).toBe(null);
          ctx.expect(result.passed > 0).toBe(true);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'in a brand-root fan-out the same miss answers with its own exit code',
      run: (ctx) => {
        // The brand root forwards ONE target to every target, so a target that
        // does not carry it is a no-op there, not a failure. The code is the
        // whole difference, and this package ships its own copy of the rule.
        const { noMatchExitCode, NO_MATCH_EXIT_CODE, FANOUT_ENV } = require('@omega.js/devkit/test/scope');

        ctx.expect(FANOUT_ENV).toBe('OMEGA_TEST_FANOUT');
        ctx.expect(NO_MATCH_EXIT_CODE).toBe(3);
        ctx.expect(noMatchExitCode({})).toBe(1);
        ctx.expect(noMatchExitCode({ OMEGA_TEST_FANOUT: '1' })).toBe(3);
      },
    },
    {
      name: 'the line the CLI prints names the target',
      run: (ctx) => {
        const { noMatchMessage } = require('@omega.js/devkit/test/scope');
        ctx.expect(noMatchMessage('renderer/does-not-exist')).toBe('No test file matches "renderer/does-not-exist".');
      },
    },
  ],
});
