/**
 * lane.js tests: the closing wall-time line, sequential execution, every
 * command running whatever the others' results, the per-command summary, the
 * first failure's exit code preserved, and the lane's tee to .temp/logs/<lane>.log.
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

// A duration as the lane prints it: `0s`, `1.2s`, `350ms` or `1m 2s`.
const TIME = String.raw`(?:\d+m )?\d+(?:\.\d+)?m?s`;
const PASS = 'node -e "console.log(\'ok\')"';
const EXIT3 = 'node -e "process.exit(3)"';
const EXIT5 = 'node -e "process.exit(5)"';

function esc(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function passRow(command) {
  return new RegExp(`^  ✓ ${esc(command)} \\(${TIME}\\)$`);
}

function failRow(command, code) {
  return new RegExp(`^  ✗ ${esc(command)} \\(${TIME}, exit ${code}\\)$`);
}

// The summary block's rows: the non-blank lines between `lane <label> summary:` and the closing line.
function summaryRows(output, label) {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '');
  const start = lines.indexOf(`lane ${label} summary:`);
  assert.notEqual(start, -1, `no "lane ${label} summary:" line in:\n${output}`);
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^[✓✗] lane ${esc(label)} `).test(line));
  assert.notEqual(end, -1, 'the closing line follows the summary');
  return { rows: lines.slice(start + 1, end), closing: lines[end] };
}

test('lane: runs every command in order and closes with the lane wall time', () => {
  const run = runLane(['probe', 'node -e "console.log(\'first\')"', 'node -e "console.log(\'second\')"']);

  assert.equal(run.status, 0);
  assert.ok(run.stdout.indexOf('first') < run.stdout.indexOf('second'));
  assert.match(run.stdout, /✓ lane probe done in \d+s/);
});

test('lane: a failed command does not stop the lane, which exits with its code', () => {
  const run = runLane(['probe', PASS, EXIT3, 'node -e "console.log(\'third ran\')"']);

  assert.equal(run.status, 3);
  assert.match(run.stdout, /^third ran$/m);
});

test('lane: two failures exit with the first one\'s code and count both', () => {
  const run = runLane(['probe', EXIT3, PASS, EXIT5]);

  assert.equal(run.status, 3);
  assert.match(run.stdout, new RegExp(`^✗ lane probe failed in ${TIME} \\(2 of 3 failed, exit 3\\)$`, 'm'));
});

test('lane: more than one command prints a summary, every command in order, before the closing line', () => {
  const last = 'node -e "console.log(\'last\')"';
  const run = runLane(['probe', PASS, EXIT3, last]);
  const { rows, closing } = summaryRows(run.stdout, 'probe');

  assert.equal(rows.length, 3, `rows:\n${rows.join('\n')}`);
  assert.match(rows[0], passRow(PASS));
  assert.match(rows[1], failRow(EXIT3, 3));
  assert.match(rows[2], passRow(last));
  assert.match(closing, new RegExp(`^✗ lane probe failed in ${TIME} \\(1 of 3 failed, exit 3\\)$`));
});

test('lane: every command passing prints the summary, closes with done and exits 0', () => {
  const second = 'node -e "console.log(\'two\')"';
  const run = runLane(['probe', PASS, second]);
  const { rows, closing } = summaryRows(run.stdout, 'probe');

  assert.equal(run.status, 0);
  assert.equal(rows.length, 2, `rows:\n${rows.join('\n')}`);
  assert.match(rows[0], passRow(PASS));
  assert.match(rows[1], passRow(second));
  assert.match(closing, new RegExp(`^✓ lane probe done in ${TIME}$`));
});

test('lane: one command prints no summary, only the closing line', () => {
  const passed = runLane(['probe', PASS]);
  const failed = runLane(['probe', EXIT3]);

  assert.equal(passed.status, 0);
  assert.doesNotMatch(passed.stdout, /summary:/);
  assert.match(passed.stdout, new RegExp(`^✓ lane probe done in ${TIME}$`, 'm'));
  assert.equal(failed.status, 3);
  assert.doesNotMatch(failed.stdout, /summary:/);
  assert.match(failed.stdout, new RegExp(`^✗ lane probe failed in ${TIME} \\(1 of 1 failed, exit 3\\)$`, 'm'));
});

test('lane: a failed run\'s log file holds the summary and the closing line', (t) => {
  const label = `probe-summary-${process.pid}`;
  t.after(() => fs.rmSync(logFilePath(label), { force: true }));

  const run = runLane([label, EXIT3, PASS]);
  const contents = fs.readFileSync(logFilePath(label), 'utf8');
  const { rows, closing } = summaryRows(contents, label);

  assert.equal(run.status, 3);
  assert.equal(rows.length, 2, `rows:\n${rows.join('\n')}`);
  assert.match(rows[0], failRow(EXIT3, 3));
  assert.match(rows[1], passRow(PASS));
  assert.match(closing, new RegExp(`^✗ lane ${esc(label)} failed in ${TIME} \\(1 of 2 failed, exit 3\\)$`));
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

// #211 — a lane is the LOADED context: its children run against every other
// package's suite, so the watch-deadline knob the web suites read is exported
// here. A solo `node --test <file>` never goes through a lane and keeps the
// tight base deadline.
test('lane: every child runs with the watch-deadline scale exported', () => {
  const run = runLane(['probe', 'node -e "console.log(process.env.OMEGA_TEST_DEADLINE_SCALE)"']);

  assert.equal(run.status, 0);
  assert.match(run.stdout, /^3$/m, 'the lane default: 30s solo → 90s under load');
});

test('lane: an explicitly set scale is passed through untouched', () => {
  const run = spawnSync(process.execPath, [LANE, 'probe', 'node -e "console.log(process.env.OMEGA_TEST_DEADLINE_SCALE)"'], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '', OMEGA_TEST_DEADLINE_SCALE: '5' },
  });

  assert.equal(run.status, 0);
  assert.match(run.stdout, /^5$/m, 'the caller (or an outer lane) owns the value once it is set');
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
