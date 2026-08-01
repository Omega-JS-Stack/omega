/**
 * lane.js tests — the closing wall-time line, sequential execution, and the
 * first-failure stop with the child's exit code preserved.
 * Run: node --test scripts/lane.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const LANE = path.join(__dirname, 'lane.js');

function runLane(args) {
  return spawnSync(process.execPath, [LANE, ...args], { encoding: 'utf8' });
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
