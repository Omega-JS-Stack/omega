/**
 * Watch-deadline scaling for the rebuild-watching suites (#211).
 *
 * dev-watch, live-decisions and dev-server-restart all poll a built page until
 * the watcher rebuilds it. The deadline that makes a solo run fail FAST is the
 * one that flakes under the full parallel suite (eight sightings, always green
 * standalone), so it reads a multiplier instead: the root lane runner
 * (scripts/lane.js) exports `OMEGA_TEST_DEADLINE_SCALE` for every lane, and a
 * solo `node --test <file>` keeps the tight base deadline.
 *
 * A junk value throws — a mistyped knob that silently ran unscaled would look
 * exactly like the flake it exists to remove.
 */

// The solo deadline. Every scaled deadline is a multiple of this.
const BASE_REBUILD_DEADLINE_MS = 30000;

const SCALE_VAR = 'OMEGA_TEST_DEADLINE_SCALE';

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
 * The rebuild-watch deadline for this run.
 * @param {object} [env] - environment to read (defaults to process.env)
 * @returns {number} milliseconds
 */
function rebuildDeadlineMs(env) {
  return BASE_REBUILD_DEADLINE_MS * deadlineScale(env);
}

module.exports = { BASE_REBUILD_DEADLINE_MS, SCALE_VAR, deadlineScale, rebuildDeadlineMs };
