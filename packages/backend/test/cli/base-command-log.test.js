/**
 * Test: every `BaseCommand.log()` line carries `[@omega.js/backend:<verb>]`,
 * and data output (`print`) carries nothing, so `--raw` pipes to `jq`.
 * A REAL verb (`cwd`) runs through the dispatcher, since the verb reaching the
 * tag is the wiring under test. Run: npx omega test backend:cli/base-command-log
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const jetpack = require('fs-jetpack');

const { captureOutput } = require('../helpers/_capture-output.js');
const BuildCommand = require('../../dist/cli/commands/build.js');
const FirestoreCommand = require('../../dist/cli/commands/firestore.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const RUN = path.join(__dirname, '..', '..', 'dist', 'cli', 'run.js');

// The devkit logger may open the line with its `[HH:MM:SS]` stamp; the tag is
// the first thing after it.
const TAGGED = /^(\[\d{2}:\d{2}:\d{2}\] )?\[@omega\.js\/backend:cwd\] cwd: /;

/** Text without ANSI colour codes. */
function plain(text) {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

module.exports = defineCases({
  description: 'BaseCommand.log: every verb line carries [@omega.js/backend:<verb>]',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-verbs-log-line-carries-the-backend-tag-named-after-the-verb',
      async run({ expect }) {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-base-command-log-')));

        try {
          const result = childProcess.spawnSync(process.execPath, [RUN, 'cwd'], {
            cwd: dir,
            encoding: 'utf8',
            env: { ...process.env, FORCE_COLOR: '0' },
          });
          const lines = plain(`${result.stdout}`).split('\n').filter((line) => line.includes('cwd: '));

          expect(result.status, `the verb exits clean: ${result.stderr}`).toBe(0);
          expect(lines.length, `the verb printed its one line: ${result.stdout}`).toBe(1);
          expect(lines[0], 'the line opens with the backend tag named after the verb').toMatch(TAGGED);
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'a-log-of-an-empty-string-prints-a-blank-line',
      async run({ expect }) {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-base-command-log-')));
        const command = new BuildCommand({ firebaseProjectPath: dir, argv: { _: ['build'] }, options: { build: true } });

        try {
          const { stdout } = await captureOutput(() => command.log(''));

          expect(plain(stdout), 'a spacer is a blank line, never a bare tag').toBe('\n');
        } finally {
          jetpack.remove(dir);
        }
      },
    },

    {
      name: 'raw-data-output-is-bare-json-on-stdout-while-a-log-line-stays-tagged',
      async run({ expect }) {
        const command = new FirestoreCommand({ argv: { _: ['firestore:get'] }, options: {} });
        const data = await captureOutput(() => command.output({ a: 1 }, { raw: true }));
        const text = await captureOutput(() => command.log('text'));

        expect(data.stdout, 'the raw document alone, ready for jq').toBe('{"a":1}\n');
        expect(data.stderr, 'nothing rides stderr beside it').toBe('');
        expect(plain(text.stdout), 'a text line keeps the verb tag').toMatch(/^(\[\d{2}:\d{2}:\d{2}\] )?\[@omega\.js\/backend:firestore\] text\n$/);
      },
    },

    {
      name: 'every-verb-inherits-output-indented-without-raw',
      async run({ expect }) {
        const command = new BuildCommand({ argv: { _: ['build'] }, options: {} });
        const data = await captureOutput(() => command.output({ a: 1 }, {}));

        expect(data.stdout, 'a verb with no output of its own prints indented JSON').toBe('{\n  "a": 1\n}\n');
      },
    },
  ],
});
