/**
 * lane.js tests — the closing wall-time line, sequential execution, the
 * first-failure stop with the child's exit code preserved, and the lane's tee
 * to .temp/logs/<lane>.log.
 * Run: node --test scripts/lane.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { logFilePath } = require('./tee-log');

const LANE = path.join(__dirname, 'lane.js');

function runLane(args) {
  return spawnSync(process.execPath, [LANE, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '' },
  });
}

test('lane: runs every command in order and closes with the lane wall time', () => {
  const run = runLane(['probe', 'node -e "console.log(\'first\')"', 'node -e "console.log(\'second\')"']);

  assert.equal(run.status, 0);
  assert.ok(run.stdout.indexOf('first') < run.stdout.indexOf('second'));
  assert.match(run.stdout, /✓ lane probe done in \d+s/);
});

test('lane: stops at the first failure, keeps its exit code, still prints the time', () => {
  const run = runLane(['probe', 'node -e "process.exit(3)"', 'node -e "console.log(\'never\')"']);

  assert.equal(run.status, 3);
  assert.doesNotMatch(run.stdout, /never/);
  assert.match(run.stdout, /✗ lane probe failed in \d+s \(exit 3/);
});

test('lane: a label with no commands is a usage error', () => {
  const run = runLane(['probe']);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /Usage: node scripts\/lane\.js/);
});

test('lane: the whole lane tees to .temp/logs/<lane>.log — child output included, ANSI stripped', (t) => {
  const label = `probe:tee-${process.pid}`;
  t.after(() => fs.rmSync(logFilePath(label), { force: true }));

  const run = runLane([
    label,
    'node -e "console.log(\'\\u001b[32mgreen child\\u001b[0m\')"',
    'node -e "console.error(\'child stderr\')"',
  ]);
  const contents = fs.readFileSync(logFilePath(label), 'utf8');

  assert.equal(run.status, 0);
  assert.match(run.stdout, /\u001b\[32mgreen child\u001b\[0m/);
  assert.match(contents, /^green child$/m);
  assert.match(contents, /^child stderr$/m);
  assert.match(contents, /✓ lane probe:tee/);
  assert.doesNotMatch(contents, /\u001b\[/);
});

test('lane: a failing lane leaves the failure in the log file', (t) => {
  const label = `probe-fail-${process.pid}`;
  t.after(() => fs.rmSync(logFilePath(label), { force: true }));

  const run = runLane([label, 'node -e "console.error(\'the reason\'); process.exit(3)"']);
  const contents = fs.readFileSync(logFilePath(label), 'utf8');

  assert.equal(run.status, 3);
  assert.match(contents, /^the reason$/m);
  assert.match(contents, /✗ lane probe-fail/);
});

test('lane: a new run truncates the previous run\'s log file', (t) => {
  const label = `probe-truncate-${process.pid}`;
  t.after(() => fs.rmSync(logFilePath(label), { force: true }));

  runLane([label, 'node -e "console.log(\'first run only\')"']);
  runLane([label, 'node -e "console.log(\'second run\')"']);
  const contents = fs.readFileSync(logFilePath(label), 'utf8');

  assert.doesNotMatch(contents, /first run only/);
  assert.match(contents, /^second run$/m);
});
