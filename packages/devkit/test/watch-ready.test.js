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

// ─── The ALREADY-RUNNING watch's gate (#622) ─────────────────────────────────
// A boot that reuses a running watch has no child stdout, so the same tracker
// is fed the watch's tee'd log. Everything below is files on disk: no watch is
// started, nothing is signalled, and no pid but this test process' own is ever
// probed (signal 0 delivers nothing).

/** A temp monorepo root, optionally carrying the log a running watch tees. */
function stageWatchRoot(log) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-watch-log-')));
  if (log) {
    const logPath = path.join(root, ...local.WATCH_LOG.split(path.sep));
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, log);
  }
  return root;
}

/** The log watch-all writes: its pid header, the roster, then ready lines. */
function watchLog({ pid, packages, reported }) {
  return `${[
    `# omega log — ${new Date().toISOString()} — pid=${pid}`,
    `Watching ${packages.length} packages (src→dist): ${packages.join(', ')}`,
    ...reported.map(readyLine),
  ].join('\n')}\n`;
}

/** A pid nothing owns — probed, never guessed (ESRCH only; EPERM is alive). */
function deadPid() {
  for (let pid = 90000; pid < 99999; pid++) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code === 'ESRCH') {
        return pid;
      }
    }
  }
  throw new Error('every probed pid is taken — this machine is busier than any test expects');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('#622: a long-idle watch answers from its log at once — no boot pays for a settled watch', async () => {
  const root = stageWatchRoot(watchLog({ pid: process.pid, packages: ['backend', 'web'], reported: ['backend', 'web'] }));

  try {
    const started = Date.now();
    assert.equal(await local.awaitRunningWatchReady({ monorepoRoot: root, pid: process.pid }), 'ready');
    assert.ok(Date.now() - started < 100, 'the verdict comes off the log already on disk, not off a poll');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#622: the gate holds while a package is still preparing, and settles when its ready line lands', async () => {
  const root = stageWatchRoot(watchLog({ pid: process.pid, packages: ['backend', 'web'], reported: ['backend'] }));
  const logPath = path.join(root, ...local.WATCH_LOG.split(path.sep));

  try {
    let outcome = null;
    const ready = local.awaitRunningWatchReady({ monorepoRoot: root, pid: process.pid }).then((result) => { outcome = result; });

    await sleep(300);
    assert.equal(outcome, null, 'web has not reported — the boot is still waiting');

    fs.appendFileSync(logPath, `${readyLine('web')}\n`);
    await ready;
    assert.equal(outcome, 'ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#622: a propagation pass holds the gate even on a fully-reported log', async () => {
  const root = stageWatchRoot(watchLog({ pid: process.pid, packages: ['backend', 'web'], reported: ['backend', 'web'] }));
  const markerPath = path.join(root, ...local.VENDOR_PROPAGATION_LOCK.split(path.sep));
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  try {
    let outcome = null;
    const ready = local.awaitRunningWatchReady({ monorepoRoot: root, pid: process.pid }).then((result) => { outcome = result; });

    await sleep(300);
    assert.equal(outcome, null, 'the watch is idle but a pass is purging framework dists — a leg booting now requires half of one');

    fs.rmSync(markerPath, { force: true });
    await ready;
    assert.equal(outcome, 'ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#622: a marker whose owner is gone gates nothing, and is swept', () => {
  const root = stageWatchRoot();
  const markerPath = path.join(root, ...local.VENDOR_PROPAGATION_LOCK.split(path.sep));
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() }));

  try {
    assert.equal(local.vendorPropagationActive(root), false, 'a watch killed mid-pass must not park every later boot');
    assert.equal(fs.existsSync(markerPath), false, 'the stale marker is cleared, not left behind');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#622: a running propagation pass holds its marker for the pass\'s whole life', async () => {
  const root = stageWatchRoot();
  const packagesDir = path.join(root, 'packages');
  fs.mkdirSync(path.join(packagesDir, 'web'), { recursive: true });
  let heldDuringPrepare = null;

  const propagation = local.startVendorPropagation({
    packagesDir,
    packages: [], // no fs watchers — poke() is the seam the real ones call
    dependents: [{ name: 'web', dir: path.join(packagesDir, 'web') }],
    debounceMs: 10,
    runPrepare: async () => { heldDuringPrepare = local.vendorPropagationActive(root); },
  });

  try {
    propagation.poke('devkit');
    const deadline = Date.now() + 2000;
    while (heldDuringPrepare === null && Date.now() < deadline) {
      await sleep(10);
    }

    assert.equal(heldDuringPrepare, true, 'the marker is up before the first dist is touched');
    while (local.vendorPropagationActive(root) && Date.now() < deadline) {
      await sleep(10);
    }
    assert.equal(local.vendorPropagationActive(root), false, 'the pass clears its own marker when it lands');
  } finally {
    propagation.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#622: a log this watch never wrote is not read — a foreign pid header gates nothing', async () => {
  // watch-all truncates its log at launch, so a header naming anyone else is a
  // previous run's file: unreadable state, and never a reason to wait 120s.
  const root = stageWatchRoot(watchLog({ pid: deadPid(), packages: ['backend', 'web'], reported: [] }));

  try {
    const started = Date.now();
    assert.equal(await local.awaitRunningWatchReady({ monorepoRoot: root, pid: process.pid }), 'ready');
    assert.ok(Date.now() - started < 100);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#622: no log at all — the boot goes straight through instead of waiting on a missing file', async () => {
  const root = stageWatchRoot();

  try {
    assert.equal(await local.awaitRunningWatchReady({ monorepoRoot: root, pid: process.pid }), 'ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#622: a watch that dies mid-wait settles the gate at once — nothing is coming', async () => {
  const gone = deadPid();
  const root = stageWatchRoot(watchLog({ pid: gone, packages: ['backend', 'web'], reported: ['backend'] }));

  try {
    assert.equal(await local.awaitRunningWatchReady({ monorepoRoot: root, pid: gone }), 'exit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#622: a relaunched log whose header names another pid settles the gate — its ready lines are not this watch\'s', async () => {
  // watch-all truncates its log per launch, so a mid-wait SHRINK is a relaunch.
  // Whoever wrote the new file, the pid this boot waits on no longer owns the
  // log: those ready lines belong to a different watch and must not be
  // conflated with the pass this gate is holding for.
  const chatter = `${Array.from({ length: 40 }, () => "[backend  ] [17:47:26] 'prepare-package': Starting (copy mode)...").join('\n')}\n`;
  const root = stageWatchRoot(watchLog({ pid: process.pid, packages: ['backend', 'web'], reported: ['backend'] }) + chatter);
  const logPath = path.join(root, ...local.WATCH_LOG.split(path.sep));

  try {
    let outcome = null;
    const ready = local.awaitRunningWatchReady({ monorepoRoot: root, pid: process.pid }).then((result) => { outcome = result; });

    await sleep(300);
    assert.equal(outcome, null, 'web has not reported — the boot is still waiting');

    // Shorter than what was read (the shrink IS the relaunch signal), a foreign
    // pid header, and every package reporting ready.
    fs.writeFileSync(logPath, watchLog({ pid: deadPid(), packages: ['backend', 'web'], reported: ['backend', 'web'] }));
    await ready;

    assert.equal(outcome, 'exit', 'a log this watch no longer owns is unreadable state, never a ready verdict');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
