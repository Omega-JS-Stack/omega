/**
 * Test: the backend's log lanes ([#197](https://github.com/Omega-JS-Stack/omega/issues/197)).
 *
 * Two lanes, two homes, and they must not be confused:
 *   - `attachVerbLog(verb)` tees THIS process to `<targetRoot>/logs/<verb>.log` —
 *     the cross-framework lane every framework's dev/build/test writes.
 *   - `getLogsPath()` is `dist/`, where the firebase CHILD processes' output
 *     lands beside firebase-tools' own *-debug.log files. `sweepStaleLogs()`
 *     clears our files there (and the reset sentinels) at every verb start —
 *     and must leave firebase-tools' debug logs alone, since a crashed run is
 *     diagnosed from them.
 *
 * Real files in a real temp target root; no emulator needed.
 *
 * Run: npx omega test backend:cli/verb-logs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const BaseCommand = require('../../dist/cli/commands/base-command.js');
const attachLogFile = require('../../dist/cli/utils/attach-log-file.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const { withoutCI } = require('../../dist/vendor/devkit/test/without-ci.js');

// A command bound to a throwaway target root — BaseCommand reads its paths off main.
function commandInTempApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-backend-verb-logs-'));
  return { root, command: new BaseCommand({ firebaseProjectPath: root, argv: {}, options: {} }) };
}

module.exports = defineCases({
  description: 'log lanes — the verb tee at the target root, the sweep in dist/',
  type: 'group',

  tests: [
    {
      name: 'attach-verb-log-tees-this-process-to-target-root-logs',
      async run({ expect }) {
        const { root, command } = commandInTempApp();

        // The tee deliberately skips under a runner; this asserts what it does when it does not.
        const logPath = withoutCI(() => {
          const restoreTee = attachLogFile.mark();
          const resolved = command.attachVerbLog('test');
          console.log('\x1B[33mverb log line\x1B[0m');
          restoreTee();
          return resolved;
        });

        expect(logPath, 'the verb log lives at <targetRoot>/logs/').toBe(path.join(root, 'logs', 'test.log'));

        const contents = fs.readFileSync(logPath, 'utf8');
        expect(contents.includes('verb log line'), 'the run lands in the file').toBeTruthy();
        expect(contents.includes('\x1B['), 'the file is ANSI-free').toBe(false);

        jetpack.remove(root);
      },
    },

    {
      name: 'verb-log-and-child-log-are-different-files',
      async run({ expect }) {
        const { root, command } = commandInTempApp();

        // dist/dev.log is the firebase child's; logs/dev.log is ours. Confusing
        // them would have one truncate the other on every boot.
        expect(command.getLogsPath('dev.log')).toBe(path.join(root, 'dist', 'dev.log'));
        expect(command.getLogsPath('dev.log')).not.toBe(path.join(root, 'logs', 'dev.log'));

        jetpack.remove(root);
      },
    },

    {
      name: 'sweep-clears-our-stale-logs-and-sentinels-but-not-firebase-debug-logs',
      async run({ expect }) {
        const { root, command } = commandInTempApp();

        const ours = ['dev.log', 'deploy.log', 'emulator.log', 'production.log'];
        const theirs = ['firestore-debug.log', 'firebase-debug.log', 'ui-debug.log'];
        for (const name of [...ours, ...theirs]) {
          jetpack.write(command.getLogsPath(name), 'stale line from the previous run\n');
        }
        for (const name of ['dev.log.reset', 'emulator.log.reset']) {
          jetpack.write(command.getTempPath(name), '');
        }

        command.sweepStaleLogs();

        for (const name of ours) {
          expect(jetpack.exists(command.getLogsPath(name)), `${name} must be swept`).toBe(false);
        }
        for (const name of theirs) {
          expect(jetpack.exists(command.getLogsPath(name)), `${name} is firebase-tools' — never swept`).toBe('file');
        }
        for (const name of ['dev.log.reset', 'emulator.log.reset']) {
          expect(jetpack.exists(command.getTempPath(name)), `${name} sentinel must be swept`).toBe(false);
        }

        jetpack.remove(root);
      },
    },
  ],
});
