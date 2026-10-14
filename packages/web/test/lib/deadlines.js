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
const path = require('node:path');

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
 * A watch case's own timeout: the deadline's ceiling (the floor at the capped
 * load factor, times the lane scale) three times over, so a case holding
 * several sequential waits ends on its waits' verdict, never a bare timeout.
 * @param {object} [options]
 * @param {object} [options.env] - environment to read the lane knob from
 * @returns {number} milliseconds
 */
function caseTimeoutMs(options) {
  const { env } = options || {};

  return Math.round(BASE_REBUILD_DEADLINE_MS * MAX_LOAD_FACTOR * deadlineScale(env) * 3);
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
 * The optional `nudge` re-fires the SAME edit while the watcher shows no sign
 * of life (#688): a freshly created watch root's FSEvents stream can still be
 * initializing when the first edit lands, so the one save falls before the
 * stream's start and is never replayed — a human just saves again. Nudging
 * stops the moment a build starts after the wait began: a rebuild that woke
 * but served stale bytes still fails, which is the staleness regression (#49)
 * these suites exist to catch.
 *
 * @param {object} options
 * @param {function} options.read - reads the built artifact (a string)
 * @param {RegExp} options.pattern - what the rebuild must produce
 * @param {string} options.message - what this wait is proving
 * @param {object} [options.builds] - a buildRecorder()
 * @param {function} [options.nudge] - re-fires the edit (needs `builds`)
 * @param {number} [options.nudgeMs] - gap between re-fires
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
    nudge = null,
    nudgeMs = 2000,
    pollMs = POLL_MS,
    env,
    load,
    cpus,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  const deadlineMs = rebuildDeadlineMs({ env, load, cpus });
  const startedAt = now();
  const startedBuilds = builds ? builds.state.started : 0;
  let lastNudgeAt = startedAt;
  let rendered = read();

  while (!pattern.test(rendered) && now() - startedAt < deadlineMs) {
    await sleep(pollMs);
    if (nudge && builds && builds.state.started === startedBuilds && now() - lastNudgeAt >= nudgeMs) {
      nudge();
      lastNudgeAt = now();
    }
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

/**
 * The files a chokidar watcher does not list yet. A file is listed the moment
 * its own fs watcher is armed, so a listed file's next edit is seen.
 * @param {object} watcher - a chokidar FSWatcher
 * @param {string[]} files - absolute paths
 * @returns {string[]} the unlisted ones
 */
function unwatchedFiles(watcher, files) {
  const listed = new Set();
  for (const [dir, children] of Object.entries(watcher.getWatched())) {
    children.forEach((child) => listed.add(path.resolve(watcher.options.cwd || '', dir, child)));
  }

  return files.filter((file) => !listed.has(file));
}

/**
 * Poll a chokidar watcher until it lists every file, to the derived deadline.
 *
 * chokidar emits `ready` before its directory walk ends whenever a watch root
 * is missing (Eleventy always registers some), so an edit made the moment
 * `watch()` resolves can predate its file's watcher and is never reported.
 * @param {object} options
 * @param {object} options.watcher - a chokidar FSWatcher (Eleventy's `elev.watcher`)
 * @param {string[]} options.files - absolute paths the suite will edit
 * @returns {Promise<void>}
 */
async function waitForWatched(options) {
  const { watcher, files } = options;
  const deadlineMs = rebuildDeadlineMs();
  const startedAt = Date.now();
  let pending = unwatchedFiles(watcher, files);

  while (pending.length && Date.now() - startedAt < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    pending = unwatchedFiles(watcher, files);
  }

  assert.deepEqual(pending, [], `the watcher never armed these files in ${Date.now() - startedAt}ms (deadline ${deadlineMs}ms)`);
}

module.exports = {
  BASE_REBUILD_DEADLINE_MS,
  MAX_LOAD_FACTOR,
  SCALE_VAR,
  POLL_MS,
  deadlineScale,
  loadFactor,
  rebuildDeadlineMs,
  caseTimeoutMs,
  buildRecorder,
  waitForRebuild,
  waitForWatched,
};
