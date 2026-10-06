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
const defineCases = require('@omega.js/devkit/test/define-cases');

const {
  BASE_REBUILD_DEADLINE_MS,
  MAX_LOAD_FACTOR,
  SCALE_VAR,
  buildRecorder,
  caseTimeoutMs,
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

module.exports = defineCases({
  type: 'group',
  description: 'rebuild-deadline',
  timeout: caseTimeoutMs(),
  tests: [
    {
      name: 'a rebuild slower than the old fixed ceiling lands, because the machine is measurably busy',
      run: async (ctx) => {
        const clock = virtualClock();

        await waitForRebuild({
          read: stubRebuild(clock, SLOW_REBUILD_MS),
          pattern: /data-layout="AFTER"/,
          message: 'the rebuild serves the edit',
          ...LOADED,
          now: clock.now,
          sleep: clock.sleep,
        });

        ctx.expect(clock.now() >= SLOW_REBUILD_MS, 'the wait really did run past the old ceiling').toBeTruthy();
        ctx.expect(rebuildDeadlineMs(LOADED), 'a 5×-oversubscribed machine buys the watcher 5× the room').toBe(5 * BASE_REBUILD_DEADLINE_MS);
      },
    },

    {
      name: 'the same rebuild fails on an idle machine — the fixed ceiling WAS the flake',
      run: async (ctx) => {
        const clock = virtualClock();

        // An idle machine is the old behavior exactly: the floor, and nothing else.
        await ctx.expect((() => waitForRebuild({
            read: stubRebuild(clock, SLOW_REBUILD_MS),
            pattern: /data-layout="AFTER"/,
            message: 'the rebuild serves the edit',
            load: 1,
            cpus: 10,
            now: clock.now,
            sleep: clock.sleep,
          }))(), 'a 45s rebuild against a 30s ceiling is exactly what the lane kept reporting as a failure').rejects.toThrow(/no rebuild carried it in 30000ms/);

        ctx.expect(clock.now() < SLOW_REBUILD_MS, 'it gave up before the rebuild it was waiting for landed').toBeTruthy();
      },
    },

    {
      name: 'a genuine hang still fails, naming the elapsed time and the last rebuild event',
      run: async (ctx) => {
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

        ctx.expect(failure, 'a rebuild that never lands must still fail — a derived deadline is not an absent one').toBeTruthy();
        ctx.expect(failure.message, 'the failure names the elapsed time').toMatch(/no rebuild carried it in 150000ms/);
        ctx.expect(failure.message, 'and how that deadline was derived').toMatch(/deadline 150000ms = 30000ms floor × 5\.00 load factor × 1 lane scale/);
        ctx.expect(failure.message, 'and the last rebuild event seen, which says the watcher was alive but never produced the edit').toMatch(/last rebuild event: build #2 finished/);
      },
    },

    {
      name: 'a watcher that never woke reads differently from one that kept rebuilding',
      run: async (ctx) => {
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

        ctx.expect(failure.message, 'the two failures a flake investigation has to tell apart must not print the same line').toMatch(/no build event was seen at all — the watcher never woke/);
      },
    },

    {
      name: 'the deadline is the floor on an idle machine, capped on a wedged one, and the lane knob still multiplies',
      run: (ctx) => {
        ctx.expect(rebuildDeadlineMs({ load: 0.5, cpus: 10 }), 'an idle machine is the solo floor — an unchanged solo run').toBe(BASE_REBUILD_DEADLINE_MS);
        ctx.expect(rebuildDeadlineMs({ load: 10, cpus: 10 }), 'a fully-but-not-over-subscribed machine buys nothing either').toBe(BASE_REBUILD_DEADLINE_MS);
        ctx.expect(loadFactor({ load: 500, cpus: 10 }), 'a wedged machine is capped — a hang must still reach a verdict').toBe(MAX_LOAD_FACTOR);

        // The #211 knob is unchanged: the lane runner's multiplier applies on top.
        ctx.expect(rebuildDeadlineMs({ load: 50, cpus: 10, env: { [SCALE_VAR]: '3' } })).toBe(15 * BASE_REBUILD_DEADLINE_MS);
        ctx.expect(deadlineScale({ [SCALE_VAR]: '' }), 'an empty knob is an unset knob').toBe(1);
        ctx.expect(() => rebuildDeadlineMs({ env: { [SCALE_VAR]: 'fast' } }), 'a mistyped knob is loud, never silently unscaled').toThrow(/positive number/);
      },
    },

    {
      name: 'the real machine is measured, not assumed',
      run: (ctx) => {
        // No injection: the defaults must read this machine, and the floor holds
        // whatever it says.
        ctx.expect(loadFactor() >= 1 && loadFactor() <= MAX_LOAD_FACTOR, 'the live factor is inside its own bounds').toBeTruthy();
        ctx.expect(rebuildDeadlineMs() >= BASE_REBUILD_DEADLINE_MS, 'and never buys less than the solo floor').toBeTruthy();
      },
    },

    // ─── The first-edit nudge (#688) ─────────────────────────────────────────────
    // A freshly created watch root's FSEvents stream can still be initializing
    // when the first edit lands — the one save falls before the stream's start
    // and is never replayed, so the wait times out with "1 started, 1 finished".
    // The nudge re-fires the SAME save until the watcher shows life, and stops
    // the moment a build starts: a rebuild that woke but served stale content
    // still fails, which is the staleness regression (#49) these suites exist for.

    {
      name: 'a lost first edit is re-fired until the watcher wakes, then the nudging stops',
      run: async (ctx) => {
        const clock = virtualClock();
        const builds = buildRecorder();
        let nudges = 0;
        let content = 'BEFORE';

        await waitForRebuild({
          read: () => content,
          pattern: /AFTER/,
          message: 'the re-fired edit lands',
          builds,
          nudge: () => {
            nudges += 1;
            // The second re-save is finally heard: the watcher wakes and rebuilds
            if (nudges === 2) {
              builds.onStart();
              builds.onFinish();
              content = 'AFTER';
            }
          },
          nudgeMs: 2000,
          load: 0,
          cpus: 8,
          env: {},
          now: clock.now,
          sleep: clock.sleep,
        });

        ctx.expect(nudges, 'the edit was re-fired until delivery, never after').toBe(2);
      },
    },

    {
      name: 'a rebuild that woke but served stale content is never nudged — it fails as the staleness it is',
      run: async (ctx) => {
        const clock = virtualClock();
        const builds = buildRecorder();
        let nudges = 0;
        let woken = false;

        await ctx.expect((() => waitForRebuild({
            read: () => 'BEFORE',
            pattern: /AFTER/,
            message: 'a stale rebuild must fail',
            builds,
            nudge: () => { nudges += 1; },
            nudgeMs: 2000,
            load: 0,
            cpus: 8,
            env: {},
            now: clock.now,
            sleep: async (ms) => {
              // The watcher woke on its own right away — and served stale bytes
              if (!woken) {
                woken = true;
                builds.onStart();
                builds.onFinish();
              }
              await clock.sleep(ms);
            },
          }))()).rejects.toThrow(/a stale rebuild must fail/);

        ctx.expect(nudges, 'a woken watcher is never re-nudged — the failure stays a staleness failure').toBe(0);
      },
    },
  ],
});
