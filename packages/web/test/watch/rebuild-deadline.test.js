/**
 * The watch lane's rebuild deadline (#615).
 *
 * The rebuild-watching suites poll a built artifact until the watcher rewrites
 * it. A FIXED 30s ceiling passed alone (1.9s for the case that failed) and
 * timed out under load — three sightings on 2026-08-25, none of them a
 * regression. The deadline is derived now: the solo floor, times this
 * machine's measured contention, times the lane's load knob.
 *
 * Both measurements are INJECTED here (`load`/`cpus`, and a virtual clock
 * through waitForRebuild's `now`/`sleep` seam): a suite that proves how a
 * deadline behaves at 45 seconds on a 5×-oversubscribed machine must not spend
 * 45 seconds proving it, and — the point of the issue — must not itself be the
 * thing that fails when the machine is busy. Everything else is real: the real
 * derivation, the real poll loop, the real assertion.
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  BASE_REBUILD_DEADLINE_MS,
  MAX_LOAD_FACTOR,
  SCALE_VAR,
  buildRecorder,
  deadlineScale,
  loadFactor,
  rebuildDeadlineMs,
  waitForRebuild,
} = require('../lib/deadlines.js');

// This file asserts the SOLO derivation. Under the root lane runner the
// process carries the lane knob (OMEGA_TEST_DEADLINE_SCALE=3), which would
// triple every expected number below; the one case that proves the knob
// passes it explicitly through `env`.
delete process.env[SCALE_VAR];

// This file asserts the SOLO derivation. Under the root lane runner the
// process carries the lane knob (scripts/lane.js exports 3), and every call
// below that passes no `env` would read it — so the knob is cleared here and
// the one assertion about it passes its own `env`.
delete process.env[SCALE_VAR];

// A machine carrying five times its own cores — a second suite, another
// worker, a brand stack. The shape of the runs that flaked (#615 was sighted
// at load 51 on 10 cores).
const LOADED = { load: 50, cpus: 10 };

// When the stubbed rebuild lands: past the old fixed ceiling, inside the
// deadline that contention derives (30000 × 5 = 150000).
const SLOW_REBUILD_MS = 45000;

/** A clock that only moves when the waiter sleeps. */
function virtualClock() {
  let elapsed = 0;

  return {
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms; },
  };
}

/** A rebuild that lands at `landsAtMs` on the given clock — or never. */
function stubRebuild(clock, landsAtMs) {
  return () => (landsAtMs !== null && clock.now() >= landsAtMs ? 'data-layout="AFTER"' : 'data-layout="BEFORE"');
}

test('a rebuild slower than the old fixed ceiling lands, because the machine is measurably busy', async () => {
  const clock = virtualClock();

  await waitForRebuild({
    read: stubRebuild(clock, SLOW_REBUILD_MS),
    pattern: /data-layout="AFTER"/,
    message: 'the rebuild serves the edit',
    ...LOADED,
    now: clock.now,
    sleep: clock.sleep,
  });

  assert.ok(clock.now() >= SLOW_REBUILD_MS, 'the wait really did run past the old ceiling');
  assert.equal(rebuildDeadlineMs(LOADED), 5 * BASE_REBUILD_DEADLINE_MS, 'a 5×-oversubscribed machine buys the watcher 5× the room');
});

test('the same rebuild fails on an idle machine — the fixed ceiling WAS the flake', async () => {
  const clock = virtualClock();

  // An idle machine is the old behavior exactly: the floor, and nothing else.
  await assert.rejects(
    () => waitForRebuild({
      read: stubRebuild(clock, SLOW_REBUILD_MS),
      pattern: /data-layout="AFTER"/,
      message: 'the rebuild serves the edit',
      load: 1,
      cpus: 10,
      now: clock.now,
      sleep: clock.sleep,
    }),
    /no rebuild carried it in 30000ms/,
    'a 45s rebuild against a 30s ceiling is exactly what the lane kept reporting as a failure',
  );

  assert.ok(clock.now() < SLOW_REBUILD_MS, 'it gave up before the rebuild it was waiting for landed');
});

test('a genuine hang still fails, naming the elapsed time and the last rebuild event', async () => {
  const clock = virtualClock();
  const builds = buildRecorder();

  // The watcher woke, built twice, and then stopped producing the edit — the
  // failure has to be able to say that.
  builds.onStart();
  builds.onFinish();
  builds.onStart();
  builds.onFinish();

  const failure = await waitForRebuild({
    read: stubRebuild(clock, null),
    pattern: /data-layout="AFTER"/,
    message: 'the rebuild serves the edit',
    builds,
    ...LOADED,
    now: clock.now,
    sleep: clock.sleep,
  }).then(() => null, (error) => error);

  assert.ok(failure, 'a rebuild that never lands must still fail — a derived deadline is not an absent one');
  assert.match(failure.message, /no rebuild carried it in 150000ms/, 'the failure names the elapsed time');
  assert.match(failure.message, /deadline 150000ms = 30000ms floor × 5\.00 load factor × 1 lane scale/, 'and how that deadline was derived');
  assert.match(failure.message, /last rebuild event: build #2 finished/, 'and the last rebuild event seen, which says the watcher was alive but never produced the edit');
});

test('a watcher that never woke reads differently from one that kept rebuilding', async () => {
  const clock = virtualClock();

  const failure = await waitForRebuild({
    read: stubRebuild(clock, null),
    pattern: /data-layout="AFTER"/,
    message: 'the rebuild serves the edit',
    builds: buildRecorder(),
    ...LOADED,
    now: clock.now,
    sleep: clock.sleep,
  }).then(() => null, (error) => error);

  assert.match(failure.message, /no build event was seen at all — the watcher never woke/,
    'the two failures a flake investigation has to tell apart must not print the same line');
});

test('the deadline is the floor on an idle machine, capped on a wedged one, and the lane knob still multiplies', () => {
  assert.equal(rebuildDeadlineMs({ load: 0.5, cpus: 10 }), BASE_REBUILD_DEADLINE_MS, 'an idle machine is the solo floor — an unchanged solo run');
  assert.equal(rebuildDeadlineMs({ load: 10, cpus: 10 }), BASE_REBUILD_DEADLINE_MS, 'a fully-but-not-over-subscribed machine buys nothing either');
  assert.equal(loadFactor({ load: 500, cpus: 10 }), MAX_LOAD_FACTOR, 'a wedged machine is capped — a hang must still reach a verdict');

  // The #211 knob is unchanged: the lane runner's multiplier applies on top.
  assert.equal(rebuildDeadlineMs({ load: 50, cpus: 10, env: { [SCALE_VAR]: '3' } }), 15 * BASE_REBUILD_DEADLINE_MS);
  assert.equal(deadlineScale({ [SCALE_VAR]: '' }), 1, 'an empty knob is an unset knob');
  assert.throws(() => rebuildDeadlineMs({ env: { [SCALE_VAR]: 'fast' } }), /positive number/, 'a mistyped knob is loud, never silently unscaled');
});

test('the real machine is measured, not assumed', () => {
  // No injection: the defaults must read this machine, and the floor holds
  // whatever it says.
  assert.ok(loadFactor() >= 1 && loadFactor() <= MAX_LOAD_FACTOR, 'the live factor is inside its own bounds');
  assert.ok(rebuildDeadlineMs() >= BASE_REBUILD_DEADLINE_MS, 'and never buys less than the solo floor');
});
