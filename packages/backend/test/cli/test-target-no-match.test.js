/**
 * The no-match rule for test targets
 * ([#814](https://github.com/Omega-JS-Stack/omega/issues/814)).
 *
 * `omega test backend:routes/typo` with no such file selected nothing and
 * reported "0 passing" at exit 0, so a typo'd path target, or a suite renamed
 * out from under one, ran silently green.
 *
 * Run: npx omega test backend:cli/test-target-no-match
 *
 * The guard sits ahead of the config/health/accounts preflight, which is what
 * lets the runner answer here with no emulator at all: a typo is refused in a
 * second rather than after a whole stack comes up.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TestRunner = require('../../dist/test/runner.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A runner with no emulator config whatsoever, over a project that has no
// test/ dir: every target below names the FRAMEWORK source.
function runnerFor(testPaths) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-no-match-'));

  return new TestRunner({
    projectDir,
    testPaths,
    isFrameworkSelfTest: true,
  });
}


// The runner ENTRY (the child the CLI runs inside the emulator), spawned with a
// target that names nothing: the guard answers before any emulator contact, so
// the exit code is readable offline.
//
// The fan-out signal is CLEARED in the base env and set only by the case that
// wants it. This suite is itself reachable under the signal (a brand root's
// `omega test framework:` forwards the backend corpus with it set), and an
// inherited one would have flipped the standalone case to the fan-out answer.
function runEntry(env) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-no-match-'));
  const config = { projectDir, testPaths: ['backend:cli/does-not-exist'], isFrameworkSelfTest: true };

  return spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'dist', 'test', 'run-tests.js')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OMEGA_TEST_FANOUT: '',
      OMEGA_TEST_CONFIG: Buffer.from(JSON.stringify(config)).toString('base64'),
      ...env,
    },
  });
}

module.exports = defineCases({
  description: 'test targets that match nothing',
  type: 'group',

  tests: [
    {
      name: 'a-named-target-that-selects-no-file-comes-back-flagged',
      async run({ assert }) {
        const results = await runnerFor(['backend:cli/does-not-exist']).run();

        assert.equal(results.noMatch, 'backend:cli/does-not-exist');
        assert.equal(results.passed, 0);
        assert.equal(results.failed, 0);
      },
    },

    {
      name: 'the-guard-answers-ahead-of-the-preflight-so-a-typo-is-the-reason-given',
      async run({ assert }) {
        // No apiUrl, no adminKey: the preflight would abort this run. The typo
        // is what it reports, and it reports it before connecting to anything.
        const results = await runnerFor(['backend:cli/does-not-exist']).run();

        assert.equal(results.aborted, false);
      },
    },

    {
      name: 'a-target-naming-a-real-suite-still-selects-it',
      async run({ assert }) {
        const results = await runnerFor(['backend:cli/test-runner-env']).run();

        // Selected, so the run moved on to the preflight it has no config for.
        assert.equal(results.noMatch, null);
        assert.equal(results.aborted, true);
      },
    },

    {
      name: 'a-run-that-named-no-file-is-not-a-no-match-run',
      async run({ assert }) {
        const results = await runnerFor([]).run();

        assert.equal(results.noMatch, null);
      },
    },

    {
      name: 'the-runner-entry-exits-1-on-a-no-match',
      run({ assert }) {
        // Standalone: no fan-out signal, whatever this run inherited.
        const result = runEntry({});

        assert.match(result.stdout, /No test file matches "backend:cli\/does-not-exist"\./);
        assert.equal(result.status, 1);
      },
    },

    {
      name: 'in-a-brand-root-fan-out-the-same-miss-answers-with-its-own-exit-code',
      run({ assert }) {
        // The brand root forwards ONE target to every target, so a target that
        // does not carry it is a no-op there rather than a failure.
        const result = runEntry({ OMEGA_TEST_FANOUT: '1' });

        assert.equal(result.status, 3);
      },
    },
  ],
});
