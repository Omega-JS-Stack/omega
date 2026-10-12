/**
 * The one event envelope: every case an app runs comes back to its driver as
 * one stdout or console line, `__OMEGA_TEST__` plus the JSON of the run-case
 * event `{ id, name, status, durationMs, reason?, error? }`. In-app code gets the
 * prefix from the host (serialized data or an injected source), never a literal.
 */

const { errorOf } = require('./run-case.js');

const EVENT_PREFIX = '__OMEGA_TEST__';

/**
 * One case event as an envelope line, without the newline.
 * @param {object} event - A run-case event.
 * @returns {string} The line.
 */
function eventLine(event) {
  return `${EVENT_PREFIX}${JSON.stringify(event)}`;
}

/**
 * The case event an envelope line carries. A prefixed line whose rest is not
 * JSON is an event with no id, failed with the parse error, so a driver fails
 * its unreported cases instead of throwing inside a stream listener.
 * @param {string} line - One output line of an app.
 * @returns {object|null} The event, or null for any other line.
 */
function parseEventLine(line) {
  if (!line.startsWith(EVENT_PREFIX)) return null;
  const rest = line.slice(EVENT_PREFIX.length);
  try {
    return JSON.parse(rest);
  } catch (e) {
    return { id: null, status: 'fail', error: errorOf(new Error(`a malformed test event line (${e.message}): ${rest}`)) };
  }
}

// An error as event data; one that is data already (a malformed line's) keeps its message and stack.
function plainError(error) {
  if (error instanceof Error || !error || typeof error.message !== 'string') return errorOf(error);
  return { name: error.name || 'Error', message: error.message, stack: error.stack };
}

/**
 * Report every case with one outcome, in order, for cases a driver cannot run.
 * @param {Array<{id: string, name: string}>} cases - Normalized cases.
 * @param {Function} report - The runner's `report(event)`.
 * @param {{status: 'skip', reason: string}|{status: 'fail', error: *}} outcome - Why they did not run;
 *   the error is an Error or already event data.
 * @returns {void}
 */
function reportEvery(cases, report, outcome) {
  for (const caseDef of cases) {
    const event = { id: caseDef.id, name: caseDef.name, status: outcome.status, durationMs: 0 };
    if (outcome.status === 'skip') event.reason = outcome.reason;
    else event.error = plainError(outcome.error);
    report(event);
  }
}

/**
 * The case events of one app run, as its driver reads them: each event goes to
 * `report` and its id into `reported`, and the first malformed line (`id: null`)
 * is kept. `settle(cases, error)` fails every case still unreported with `error`,
 * else with the kept malformed error; with neither, the runner's ended check fails them.
 * @param {Function} report - The runner's `report(event)`.
 * @returns {{reported: Set<string>, onEvent: Function, settle: Function}} The tracker.
 */
function createEventTracker(report) {
  const reported = new Set();
  let malformed = null;
  return {
    reported,
    onEvent(event) {
      if (event.id === null) {
        malformed = malformed || event.error;
        return;
      }
      reported.add(event.id);
      report(event);
    },
    settle(cases, error) {
      const cause = error || malformed;
      if (!cause) return;
      reportEvery(cases.filter((caseDef) => !reported.has(caseDef.id)), report, { status: 'fail', error: cause });
    },
  };
}

module.exports = { EVENT_PREFIX, eventLine, parseEventLine, reportEvery, createEventTracker };
