/**
 * steps-log.js tests — the per-step verdict record every e2e runner leaves in
 * its .temp/<lane>/ dir. The post-mortem question these pin is #196's: after a
 * runner dies, WHICH step failed and why?
 * Run: node --test scripts/steps-log.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.join(__dirname, 'steps-log.js');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-steps-'));
}

/** Drive a fake runner in a child process, then read back its steps.log. */
function runFakeRunner(dir, body) {
  const script = `
    const { createStepsLog } = require(${JSON.stringify(HELPER)});
    const steps = createStepsLog(${JSON.stringify(dir)});
    ${body}
  `;
  const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const file = path.join(dir, 'steps.log');
  return { run, file, contents: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
}

test('steps log: records each verdict, and a failing step keeps its name + detail', () => {
  const dir = tempDir();
  const { contents } = runFakeRunner(dir, `
    steps.pass('the emulator boots', 'port 5002');
    steps.fail('the popup reaches the SW', new Error('timed out after 30s'));
  `);

  assert.match(contents, /^PASS {2}the emulator boots \(port 5002\)$/m);
  assert.match(contents, /^FAIL {2}the popup reaches the SW — timed out after 30s$/m);
});

test('steps log: a hard crash still leaves every completed step on disk', () => {
  const dir = tempDir();
  const { contents } = runFakeRunner(dir, `
    steps.pass('the emulator boots');
    steps.fail('the popup reaches the SW', new Error('timed out after 30s'));
    process.kill(process.pid, 'SIGKILL');
    steps.pass('never reached');
  `);

  assert.match(contents, /^PASS {2}the emulator boots$/m);
  assert.match(contents, /^FAIL {2}the popup reaches the SW/m);
  assert.doesNotMatch(contents, /never reached/);
});

test('steps log: a multi-line failure detail collapses to ONE line per step', () => {
  const dir = tempDir();
  const { contents } = runFakeRunner(dir, `
    steps.fail('the account page renders', new Error('assert failed:\\n  expected: signed in\\n  actual:   signed out'));
  `);

  const verdicts = contents.split('\n').filter((line) => /^(PASS|FAIL) /.test(line));
  assert.equal(verdicts.length, 1);
  assert.match(verdicts[0], /^FAIL {2}the account page renders — assert failed: expected: signed in actual: signed out$/);
});

test('steps log: a new run truncates the previous run\'s verdicts', () => {
  const dir = tempDir();
  runFakeRunner(dir, `steps.pass('first run only');`);
  const { contents } = runFakeRunner(dir, `steps.pass('second run');`);

  assert.doesNotMatch(contents, /first run only/);
  assert.match(contents, /^PASS {2}second run$/m);
});

test('steps log: creates the lane dir when the runner has not made it yet', () => {
  const dir = path.join(tempDir(), 'not-made-yet');
  const { contents } = runFakeRunner(dir, `steps.pass('the emulator boots');`);

  assert.match(contents, /^PASS {2}the emulator boots$/m);
});

test('steps log: an abort BEFORE any step is recorded as a preflight failure', () => {
  const dir = tempDir();
  const { contents } = runFakeRunner(dir, `
    steps.abort(new Error('a playground emulator stack is already running (hosting :5002) — stop it and re-run'));
  `);

  assert.match(contents, /^FAIL {2}preflight — a playground emulator stack is already running \(hosting :5002\) — stop it and re-run$/m);
});

test('steps log: an abort AFTER a step failed adds nothing — that verdict is already on file', () => {
  const dir = tempDir();
  const { contents } = runFakeRunner(dir, `
    steps.fail('the popup reaches the SW', new Error('timed out after 30s'));
    steps.abort(new Error('timed out after 30s'));
  `);

  const verdicts = contents.split('\n').filter((line) => /^(PASS|FAIL) /.test(line));
  assert.equal(verdicts.length, 1);
  assert.doesNotMatch(contents, /preflight/);
});

test('steps log: the writer is devkit\'s — scripts/steps-log.js only re-exports it', () => {
  const devkitModule = require.resolve('@omega.js/devkit/test/steps-log');
  assert.equal(require(HELPER).createStepsLog, require(devkitModule).createStepsLog);
});
