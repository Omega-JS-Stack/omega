/**
 * Test: the backend's log lanes ([#197](https://github.com/Omega-JS-Stack/omega/issues/197)).
 *
 * Two lanes, two homes, and they must not be confused:
 *   - `attachVerbLog(verb)` tees THIS process to `<appRoot>/logs/<verb>.log` —
 *     the cross-framework lane every framework's dev/build/test writes.
 *   - `getLogsPath()` is `dist/`, where the firebase CHILD processes' output
 *     lands beside firebase-tools' own *-debug.log files. `sweepStaleLogs()`
 *     clears our files there (and the reset sentinels) at every verb start —
 *     and must leave firebase-tools' debug logs alone, since a crashed run is
 *     diagnosed from them.
 *
 * Real files in a real temp app root; no emulator needed.
 *
 * Run: npx omega test backend:cli/verb-logs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const BaseCommand = require('../../src/cli/commands/base-command.js');
const attachLogFile = require('../../src/cli/utils/attach-log-file.js');

// A command bound to a throwaway app root — BaseCommand reads its paths off main.
function commandInTempApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-verb-logs-'));
  return { root, command: new BaseCommand({ firebaseProjectPath: root, argv: {}, options: {} }) };
}

// The tee deliberately skips under a runner; these tests are about what it does
// when it does NOT skip, so the signal is lifted for the duration.
function withoutCiEnv(run) {
  const prior = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
    }
  }
}

module.exports = {
  description: 'log lanes — the verb tee at the app root, the sweep in dist/',
  type: 'group',

  tests: [
    {
      name: 'attach-verb-log-tees-this-process-to-app-root-logs',
      async run({ assert }) {
        const { root, command } = commandInTempApp();

        const logPath = withoutCiEnv(() => {
          const resolved = command.attachVerbLog('test');
          console.log('\x1B[33mverb log line\x1B[0m');
          attachLogFile.detach();
          return resolved;
        });

        assert.equal(logPath, path.join(root, 'logs', 'test.log'), 'the verb log lives at <appRoot>/logs/');

        const contents = fs.readFileSync(logPath, 'utf8');
        assert.ok(contents.includes('verb log line'), 'the run lands in the file');
        assert.equal(contents.includes('\x1B['), false, 'the file is ANSI-free');

        jetpack.remove(root);
      },
    },

    {
      name: 'verb-log-and-child-log-are-different-files',
      async run({ assert }) {
        const { root, command } = commandInTempApp();

        // dist/dev.log is the firebase child's; logs/dev.log is ours. Confusing
        // them would have one truncate the other on every boot.
        assert.equal(command.getLogsPath('dev.log'), path.join(root, 'dist', 'dev.log'));
        assert.notEqual(command.getLogsPath('dev.log'), path.join(root, 'logs', 'dev.log'));

        jetpack.remove(root);
      },
    },

    {
      name: 'sweep-clears-our-stale-logs-and-sentinels-but-not-firebase-debug-logs',
      async run({ assert }) {
        const { root, command } = commandInTempApp();

        const ours = ['dev.log', 'deploy.log', 'emulator.log', 'test.log', 'production.log'];
        const theirs = ['firestore-debug.log', 'firebase-debug.log', 'ui-debug.log'];
        for (const name of [...ours, ...theirs]) {
          jetpack.write(command.getLogsPath(name), 'stale line from the previous run\n');
        }
        for (const name of ['dev.log.reset', 'emulator.log.reset']) {
          jetpack.write(command.getTempPath(name), '');
        }

        command.sweepStaleLogs();

        for (const name of ours) {
          assert.equal(jetpack.exists(command.getLogsPath(name)), false, `${name} must be swept`);
        }
        for (const name of theirs) {
          assert.equal(jetpack.exists(command.getLogsPath(name)), 'file', `${name} is firebase-tools' — never swept`);
        }
        for (const name of ['dev.log.reset', 'emulator.log.reset']) {
          assert.equal(jetpack.exists(command.getTempPath(name)), false, `${name} sentinel must be swept`);
        }

        jetpack.remove(root);
      },
    },
  ],
};
