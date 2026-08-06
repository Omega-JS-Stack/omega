/**
 * Verb log files (#197) — `omega build` and `omega test` tee their whole run to
 * <appRoot>/logs/<verb>.log: the terminal keeps its colors, the file is
 * ANSI-stripped and greppable. Driven for REAL — a child process runs the actual
 * command against a temp app, so the assertion is on bytes the verb wrote, not
 * on a call being made.
 *
 * The temp app has a valid config but no src/, so each verb logs its real
 * startup output and then dies on the missing input — enough of a run to prove
 * the tee is attached from the first line, and cheap.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const COMMANDS = path.join(__dirname, '..', 'src', 'commands');

// A temp app the web commands can resolve: valid omega.json5, no src/.
function tmpApp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-verb-logs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'config', 'omega.json5'),
    '{ brand: { name: "Verb Logs", id: "verb-logs" }, targets: { web: {} } }\n',
  );
  return root;
}

// Run a command module for real in its own process, rooted at the temp app.
// CI/GITHUB_ACTIONS are stripped because the tee deliberately skips under a
// runner — this suite is about what it does when it DOESN'T skip. NODE_TEST_*
// goes for the usual reason (a child inheriting it reports as an IPC child).
function runVerb(root, verb, marker) {
  const script = [
    `process.chdir(${JSON.stringify(root)});`,
    `require(${JSON.stringify(path.join(COMMANDS, `${verb}.js`))})({ _: [] })`,
    `  .catch((e) => console.log('CAUGHT ' + e.message))`,
    `  .then(() => console.log(${JSON.stringify(marker)}));`,
  ].join('\n');

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST') && key !== 'CI' && key !== 'GITHUB_ACTIONS'),
  );
  env.FORCE_COLOR = '1';

  return spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', env });
}

test('`omega build` tees the run to logs/build.log, ANSI stripped in the file only', (t) => {
  const root = tmpApp(t);

  const result = runVerb(root, 'build', 'BUILD DONE');
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);

  const logPath = path.join(root, 'logs', 'build.log');
  assert.ok(fs.existsSync(logPath), 'the verb must open logs/build.log');
  const contents = fs.readFileSync(logPath, 'utf8');

  // The verb's own output — proof the tee is live before the work starts.
  assert.match(contents, /payment\.products is empty/, "the verb's first log line is in the file");
  assert.match(contents, /BUILD DONE/, 'the tee survives to the end of the run');

  // Both sinks, one stripped: the terminal keeps the colors, the file has none.
  assert.ok(result.stdout.includes('\x1B['), 'the terminal must still get ANSI');
  assert.ok(!contents.includes('\x1B['), 'the file must be ANSI-free');
});

test('`omega test` keeps its own tee — the build it runs never steals logs/test.log', (t) => {
  const root = tmpApp(t);

  const result = runVerb(root, 'test', 'TEST DONE');
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);

  const contents = fs.readFileSync(path.join(root, 'logs', 'test.log'), 'utf8');

  // The nested build's output lands in test.log — under the old singleton it
  // would have detached (and truncated) this file to open its own.
  assert.match(contents, /payment\.products is empty/, 'the build phase logs into test.log');
  assert.match(contents, /TEST DONE/, 'the tee is still attached after the build phase');
  assert.strictEqual(
    fs.existsSync(path.join(root, 'logs', 'build.log')),
    false,
    'a nested build must not open a second log file',
  );
});
