/**
 * Binds normalized case suites (run-case.js) to node:test. Every case is one
 * node:test `it`, and every `it` waits on its own case event, reported by id
 * from a SESSION: a host suite run through `runSuite`, or an app layer whose
 * driver runs the cases inside the app. The first case to begin starts its
 * session, so state, stop-on-failure and cleanup follow `runSuite` exactly.
 *
 * Shared by the runner and by `defineCases` when a file registers itself.
 */

const { runSuite, errorOf } = require('./run-case.js');

function rebuildError(error) {
  const rebuilt = new Error(error.message);
  rebuilt.name = error.name;
  if (error.stack) rebuilt.stack = error.stack;
  return rebuilt;
}

/**
 * A session over a set of cases: `report(event)` settles one case by id, and
 * when `start(report)` settles, every case still unreported fails.
 * @param {{cases: Array<{id: string, name: string}>, start: Function, endedMessage: string}} options
 * @returns {{wait: Function, report: Function}} `wait(id)` starts the session once and resolves to that case's event.
 */
function createCaseSession({ cases, start, endedMessage }) {
  const waiting = new Map();
  for (const caseDef of cases) {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    waiting.set(caseDef.id, { name: caseDef.name, promise, resolve, settled: false });
  }

  function report(event) {
    const entry = waiting.get(event.id);
    if (!entry) throw new Error(`A case event arrived for a case this run does not hold: ${event.id}`);
    if (entry.settled) throw new Error(`Case ${event.id} reported twice`);
    entry.settled = true;
    entry.resolve(event);
  }

  function endAll(error) {
    for (const [id, entry] of waiting) {
      if (!entry.settled) report({ id, name: entry.name, status: 'fail', durationMs: 0, error });
    }
  }

  let started = null;
  function wait(id) {
    if (!started) {
      started = Promise.resolve()
        .then(() => start(report))
        .then(
          () => endAll(errorOf(new Error(endedMessage))),
          (e) => endAll({ ...errorOf(e), message: `${endedMessage}: ${errorOf(e).message}` }),
        );
    }
    return waiting.get(id).promise;
  }

  return { wait, report };
}

/**
 * A session that runs one suite on the host through `runSuite`.
 * @param {object} suite - A normalized suite, its `layer` set.
 * @param {{expect: Function, defaultTimeout?: number, extrasFrom?: Function}} options - `extrasFrom()` resolves the ctx extras when the session starts.
 * @returns {{wait: Function, report: Function}} The session.
 */
function hostSession(suite, { expect, defaultTimeout, extrasFrom }) {
  return createCaseSession({
    cases: suite.cases,
    endedMessage: `the ${suite.layer} layer ended before this case reported`,
    start: async (report) => {
      const extras = extrasFrom ? await extrasFrom() : undefined;
      await runSuite(suite, { expect, extras, defaultTimeout, report });
    },
  });
}

/**
 * Register one suite with node:test: a `describe` holding one `it` per case.
 * @param {object} suite - A normalized suite.
 * @param {{label: string, session: object, onEvent?: Function}} options - `onEvent(event, caseDef)` sees each case event.
 * @returns {void}
 */
function registerSuite(suite, { label, session, onEvent }) {
  const { describe, it } = require('node:test');
  describe(label, () => {
    for (const caseDef of suite.cases) {
      it(caseDef.name, async (t) => {
        const event = await session.wait(caseDef.id);
        if (onEvent) onEvent(event, caseDef);
        if (event.status === 'skip') {
          t.skip(event.reason);
          return;
        }
        if (event.status === 'fail') throw rebuildError(event.error);
      });
    }
  });
}

module.exports = { createCaseSession, hostSession, registerSuite };
