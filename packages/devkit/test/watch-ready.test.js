// Unit tests for the monorepo watch's readiness gate (src/local.js, #670).
//
// The tracker is pure — lines in, verdict out — so it is fed the REAL lines
// scripts/watch-all.js prints (copied from .temp/logs/watch-all.log). No watch
// is ever spawned: the exit case drives a FAKE child through a stubbed
// child_process.spawn (installed before src/local.js binds it), and the
// timeout path belongs to a boot, not to a unit lane.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

// Before the require below: local.js destructures spawn at load time.
const spawnedWatches = [];
childProcess.spawn = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.pid = 4242;
  child.kill = () => {};
  spawnedWatches.push(child);
  return child;
};

const local = require('../src/local');

const ROSTER = 'Watching 6 packages (src→dist): backend, client, desktop, extension, manager, web';
const SHARED_ROSTER = 'Watching 6 shared packages (change → re-prepare all): devkit, config, account, template-kit, analytics, monitoring';

/** The line a package prints once its first src→dist pass has landed. */
const readyLine = (name) => `[${name.padEnd(9)}] [17:47:26] 'prepare-package': Ready for changes!`;

test('#670: the roster line sets the count, and the tracker holds until every package reports', () => {
  const tracker = local.createWatchReadyTracker();

  tracker.push(ROSTER);
  tracker.push(SHARED_ROSTER);
  assert.equal(tracker.isReady(), false);
  // The shared-package watch prints its own roster and never a ready line, so
  // only the src→dist roster may set the count.
  assert.deepEqual(tracker.pending(), ['backend', 'client', 'desktop', 'extension', 'manager', 'web']);

  for (const name of ['backend', 'client', 'desktop', 'extension', 'manager']) {
    tracker.push(readyLine(name));
    assert.equal(tracker.isReady(), false);
  }

  tracker.push(readyLine('web'));
  assert.equal(tracker.isReady(), true);
});

test('#670: a package repeating its ready line never counts twice', () => {
  const tracker = local.createWatchReadyTracker();
  tracker.push(ROSTER);

  for (let i = 0; i < 6; i++) {
    tracker.push(readyLine('backend'));
  }
  assert.equal(tracker.isReady(), false);
  assert.deepEqual(tracker.pending(), ['client', 'desktop', 'extension', 'manager', 'web']);
});

test('#670: pending() names the stragglers the timeout warning has to report', () => {
  const tracker = local.createWatchReadyTracker();
  tracker.push(ROSTER);
  ['backend', 'client', 'desktop', 'manager'].forEach((name) => tracker.push(readyLine(name)));

  assert.deepEqual(tracker.pending(), ['extension', 'web']);
});

test('#670: no roster line means no verdict — the wait falls through to the timeout', () => {
  const tracker = local.createWatchReadyTracker();
  ['backend', 'client', 'desktop', 'extension', 'manager', 'web'].forEach((name) => tracker.push(readyLine(name)));

  assert.equal(tracker.isReady(), false);
  assert.deepEqual(tracker.pending(), []);
});

test('#670: the watch\'s ordinary prepare chatter moves nothing', () => {
  const tracker = local.createWatchReadyTracker();
  tracker.push(ROSTER);
  tracker.push('[backend  ] > @omega.js/backend@0.1.0 prepare:watch');
  tracker.push("[backend  ] [17:47:26] 'prepare-package': Running initial prepare...");
  tracker.push("[backend  ] [17:47:26] 'prepare-package': Starting (copy mode)...");

  assert.equal(tracker.isReady(), false);
  assert.equal(tracker.pending().length, 6);
});

test('#670: a watch child that exits before reporting settles the wait at once', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-watch-ready-'));
  const exitHooksBefore = process.listeners('exit');
  try {
    const watch = local.startMonorepoWatch({ monorepoRoot: scratch });
    const child = spawnedWatches[spawnedWatches.length - 1];

    // Not one ready line printed — a watch that loses the lock race says
    // "nothing to do" and exits. The boot must not park on the 120s timeout.
    child.emit('exit', 0, null);

    await watch.ready;
  } finally {
    process.listeners('exit')
      .filter((hook) => !exitHooksBefore.includes(hook))
      .forEach((hook) => process.removeListener('exit', hook));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
