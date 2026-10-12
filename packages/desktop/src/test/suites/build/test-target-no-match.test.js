// Build-layer tests for the no-match rule: a path target that selects no file
// comes back flagged, never silently green. The rule lives in devkit's
// discovery, so these drive it over the desktop verb's own runner config from a
// consumer directory with no tests of its own.

const fs = require('fs');
const os = require('os');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const VERB = path.join(__dirname, '..', '..', '..', 'commands', 'test.js');

// A consumer directory with a package.json and no test/ dir at all.
function makeEmptyConsumer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-no-match-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'no-match-fixture' }));
  return dir;
}

// What the verb's run selects from `dir` for these targets.
function selectFrom(dir, targets) {
  const { runnerConfig } = require(VERB);
  const { discoverSuites } = require('@omega.js/devkit/test/discovery');
  return discoverSuites(runnerConfig({ projectRoot: dir, selfTest: false }), { targets });
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'test targets that match nothing',
  tests: [
    {
      name: 'a named target that selects no file comes back flagged, not green',
      run: (ctx) => {
        const dir = makeEmptyConsumer();

        try {
          // Every spelling of a path target: bare, framework-scoped, project-scoped.
          for (const target of ['renderer/does-not-exist', 'desktop:build/does-not-exist', 'project:does-not-exist']) {
            const result = selectFrom(dir, [target]);
            ctx.expect(result.noMatch).toBe(target);
            ctx.expect(result.files).toEqual([]);
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a run that named no file stays green with nothing to run',
      run: (ctx) => {
        const dir = makeEmptyConsumer();

        try {
          // A bare run, and a bare source prefix, ask for a source rather than
          // a file: an empty project is still an exit-0 run.
          for (const targets of [[], ['project:']]) {
            const result = selectFrom(dir, targets);
            ctx.expect(result.noMatch).toBe(null);
            ctx.expect(result.files).toEqual([]);
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a target naming a real framework suite still selects it',
      run: (ctx) => {
        const dir = makeEmptyConsumer();

        try {
          const result = selectFrom(dir, ['desktop:build/test-discovery']);
          ctx.expect(result.noMatch).toBe(null);
          ctx.expect(result.files.map((entry) => path.basename(entry.file))).toEqual(['test-discovery.test.js']);
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
