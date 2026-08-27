/**
 * Watch-deadline scaling for the rebuild-watching suites (#211, #615).
 *
 * dev-watch, live-decisions, dev-server-restart and client-dist-watch all poll
 * a built artifact until the watcher rebuilds it. The deadline that makes a
 * solo run fail FAST is the one that flakes under load, so it is DERIVED from
 * two measurements, never fixed:
 *
 *   1. The lane's load knob. The root lane runner (scripts/lane.js) exports
 *      `OMEGA_TEST_DEADLINE_SCALE` for every lane it starts.
 *   2. This machine's CONTENTION right now (#615): the 1-minute load average
 *      per CPU. A run beside other work — a second suite, another worker, a
 *      brand stack — waits proportionally longer for the watcher, and such a
 *      run never comes through the lane runner, which is how #615 was sighted
 *      three times in one day.
 *
 * Why contention and not a timed build: these fixtures build in ~20ms and
 * rebuild in ~1.7s whether the machine is idle or at load 50 (both measured
 * while fixing #615). A baseline timed from a build therefore measures nothing
 * about the pressure that makes the WATCHER late — the wait is on chokidar's
 * event, not on work.
 *
 * The floor is the old solo deadline and the load factor is capped, so a solo
 * run's failure speed is unchanged and a real hang still fails in bounded
 * time: the deadline is a multiple of a measurement, not the absence of one.
 *
 * A junk scale value throws — a mistyped knob that silently ran unscaled would
 * look exactly like the flake it exists to remove.
 */
const assert = require('node:assert/strict');
const os = require('node:os');

// The solo floor. No derived deadline is ever shorter than this.
const BASE_REBUILD_DEADLINE_MS = 30000;

// The ceiling on the contention multiplier. A wedged machine must still reach
// a verdict: 6 × 30s is the longest a hang may hide behind "it was busy".
const MAX_LOAD_FACTOR = 6;

const SCALE_VAR = 'OMEGA_TEST_DEADLINE_SCALE';

// The gap between polls of the built artifact.
const POLL_MS = 50;

/**
 * The active deadline multiplier.
 * @param {object} [env] - environment to read (defaults to process.env)
 * @returns {number} the multiplier (1 when unset)
 */
function deadlineScale(env) {
  const raw = (env || process.env)[SCALE_VAR];
  if (raw === undefined || raw === null || String(raw).trim() === '') return 1;

  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`${SCALE_VAR} must be a positive number (the watch-deadline multiplier) — got "${raw}"`);
  }

  return scale;
}

/**
 * How oversubscribed this machine is: runnable work per CPU, floored at 1 (an
 * idle machine buys no extra room) and capped at MAX_LOAD_FACTOR.
 * @param {object} [options]
 * @param {number} [options.load] - 1-minute load average (defaults to the real one)
 * @param {number} [options.cpus] - CPU count (defaults to the real one)
 * @returns {number} the contention multiplier
 */
function loadFactor(options) {
  const { load = os.loadavg()[0], cpus = os.cpus().length } = options || {};
  const measured = load / (cpus || 1);

  return Math.min(MAX_LOAD_FACTOR, Math.max(1, measured));
}

/**
 * The rebuild-watch deadline for this run.
 * @param {object} [options]
 * @param {object} [options.env] - environment to read the lane knob from
 * @param {number} [options.load] - 1-minute load average (defaults to the real one)
 * @param {number} [options.cpus] - CPU count (defaults to the real one)
 * @returns {number} milliseconds
 */
function rebuildDeadlineMs(options) {
  const { env, load, cpus } = options || {};

  return Math.round(BASE_REBUILD_DEADLINE_MS * loadFactor({ load, cpus }) * deadlineScale(env));
}

/**
 * A record of the build events a suite saw, so a timeout can say whether the
 * watcher was working or asleep (#615). Wired to Eleventy's own
 * `eleventy.before`/`eleventy.after`, or to whatever function IS the rebuild.
 * @returns {object} recorder
 */
function buildRecorder() {
  const state = { started: 0, finished: 0, lastEventAt: null, lastEvent: null };

  const note = (event) => {
    state.lastEvent = event;
    state.lastEventAt = Date.now();
  };

  return {
    state,
    onStart() {
      state.started += 1;
      note(`build #${state.started} started`);
    },
    onFinish() {
      state.finished += 1;
      note(`build #${state.finished} finished`);
    },
    /** One line naming the last rebuild event seen, for a failure message. */
    describe() {
      if (!state.lastEvent) {
        return 'no build event was seen at all — the watcher never woke';
      }

      return `last rebuild event: ${state.lastEvent}, ${Date.now() - state.lastEventAt}ms ago (${state.started} started, ${state.finished} finished)`;
    },
  };
}

/**
 * Poll `read()` until it matches `pattern`, to the derived deadline.
 *
 * On a timeout the message names the elapsed time, how the deadline was
 * derived, and the last rebuild event seen — so the next sighting says whether
 * this was a loaded machine or a watcher that stopped rebuilding, instead of
 * only "it did not match in 30s".
 *
 * `now`/`sleep` are injectable so the deadline's OWN suite can drive a virtual
 * clock: a test about load-sensitivity must not itself be load-sensitive.
 *
 * @param {object} options
 * @param {function} options.read - reads the built artifact (a string)
 * @param {RegExp} options.pattern - what the rebuild must produce
 * @param {string} options.message - what this wait is proving
 * @param {object} [options.builds] - a buildRecorder()
 * @param {number} [options.pollMs] - gap between reads
 * @param {object} [options.env] - environment to read the lane knob from
 * @param {number} [options.load] - 1-minute load average (defaults to the real one)
 * @param {number} [options.cpus] - CPU count (defaults to the real one)
 * @param {function} [options.now] - clock (defaults to Date.now)
 * @param {function} [options.sleep] - waiter (defaults to setTimeout)
 * @returns {Promise<void>}
 */
async function waitForRebuild(options) {
  const {
    read,
    pattern,
    message,
    builds = null,
    pollMs = POLL_MS,
    env,
    load,
    cpus,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  const deadlineMs = rebuildDeadlineMs({ env, load, cpus });
  const startedAt = now();
  let rendered = read();

  while (!pattern.test(rendered) && now() - startedAt < deadlineMs) {
    await sleep(pollMs);
    rendered = read();
  }

  if (pattern.test(rendered)) return;

  const factor = loadFactor({ load, cpus });
  const derivation = `deadline ${deadlineMs}ms = ${BASE_REBUILD_DEADLINE_MS}ms floor × ${factor.toFixed(2)} load factor × ${deadlineScale(env)} lane scale`;

  assert.match(
    rendered,
    pattern,
    `${message} — no rebuild carried it in ${now() - startedAt}ms (${derivation}); ${builds ? builds.describe() : 'no build events were recorded'}`,
  );
}

module.exports = {
  BASE_REBUILD_DEADLINE_MS,
  MAX_LOAD_FACTOR,
  SCALE_VAR,
  POLL_MS,
  deadlineScale,
  loadFactor,
  rebuildDeadlineMs,
  buildRecorder,
  waitForRebuild,
};
