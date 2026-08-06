/**
 * tee-log.js tests — the monorepo-surface log tee: where a label's file lands,
 * that BOTH sinks get the output, and that a new run truncates the old file.
 * This is also the unit-level pin for watch-all.js's teeing, which shares the
 * helper and cannot be exercised without stopping the live watcher.
 * Run: node --test scripts/tee-log.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.join(__dirname, 'tee-log.js');
const { logFilePath } = require('./tee-log');

const GREEN = '\u001b[32m';
const RESET = '\u001b[0m';

/** Tee inside a child process (the tee patches process-wide writers). */
function runTeed(label, body) {
  const script = `
    const { teeLog } = require(${JSON.stringify(HELPER)});
    teeLog(${JSON.stringify(label)});
    ${body}
  `;
  const run = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '' },
  });
  const file = logFilePath(label);
  return { run, file, contents: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
}

test('tee-log: a lane label maps to a predictable filesystem-safe file', () => {
  assert.equal(logFilePath('test:packages'), path.join(__dirname, '..', '.temp', 'logs', 'test-packages.log'));
  assert.equal(logFilePath('watch-all'), path.join(__dirname, '..', '.temp', 'logs', 'watch-all.log'));
});

test('tee-log: console keeps its colors, the file gets the ANSI-stripped line', (t) => {
  const label = `probe-colors-${process.pid}`;
  t.after(() => fs.rmSync(logFilePath(label), { force: true }));

  const { run, contents } = runTeed(label, `
    console.log(${JSON.stringify(`${GREEN}hi${RESET}`)});
    console.error(${JSON.stringify(`${GREEN}broke${RESET}`)});
  `);

  assert.equal(run.status, 0);
  assert.match(run.stdout, /\u001b\[32mhi\u001b\[0m/);
  assert.match(run.stderr, /\u001b\[32mbroke\u001b\[0m/);
  assert.match(contents, /^hi$/m);
  assert.match(contents, /^broke$/m);
  assert.doesNotMatch(contents, /\u001b\[/);
});

test('tee-log: a new run truncates the previous run\'s file', (t) => {
  const label = `probe-truncate-${process.pid}`;
  t.after(() => fs.rmSync(logFilePath(label), { force: true }));

  runTeed(label, `console.log('first run only');`);
  const { contents } = runTeed(label, `console.log('second run');`);

  assert.doesNotMatch(contents, /first run only/);
  assert.match(contents, /^second run$/m);
});

test('tee-log: CI writes no file — the runner already captures the output', (t) => {
  const label = `probe-ci-${process.pid}`;
  t.after(() => fs.rmSync(logFilePath(label), { force: true }));

  const script = `
    const { teeLog } = require(${JSON.stringify(HELPER)});
    teeLog(${JSON.stringify(label)});
    console.log('ci run');
  `;
  const run = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  });

  assert.match(run.stdout, /ci run/);
  assert.equal(fs.existsSync(logFilePath(label)), false);
});
