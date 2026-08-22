/**
 * Per-step verdict log — the post-mortem record every e2e runner writes beside
 * its environment logs (#197 spec item 4).
 *
 * The runners already tail their emulator/dev output into a log dir, but the
 * VERDICTS only ever existed on the console: when a lane died — or was read
 * back hours later — nobody could say which step failed (#196's blind spot).
 * This writes one line per step into `<dir>/steps.log`:
 *
 *   PASS  the playground emulator boots (port 5002)
 *   FAIL  the popup reaches the background SW — timed out after 30s
 *   FAIL  preflight — a playground emulator stack is already running
 *
 * Truncated per run, written SYNCHRONOUSLY as each step lands, so a hard crash
 * still leaves every completed step on disk — and `grep '^FAIL' steps.log`
 * names the failing step.
 *
 * Devkit owns it because the journey harness lives here too and a package must
 * never reach up into the monorepo's root `scripts/`; `scripts/steps-log.js`
 * re-exports this module for the root e2e runners.
 */

// Libraries
const fs = require('fs');
const path = require('path');

/** Collapse a message to a single greppable line — one line per step, always. */
function oneLine(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
}

/** An Error, a string, whatever a catch caught — flattened to its message. */
function reasonText(reason) {
  return reason && reason.message ? reason.message : reason;
}

/**
 * Open a lane's steps log, truncating whatever the previous run left.
 * @param {string} dir - the runner's log dir (its existing `.temp/<lane>/`)
 * @returns {{file: string, pass: Function, fail: Function, abort: Function}}
 */
function createStepsLog(dir) {
  const file = path.join(dir, 'steps.log');
  let failed = false;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `# omega e2e steps — ${new Date().toISOString()} — pid=${process.pid}\n`);

  function record(verdict, name, detail) {
    if (verdict === 'FAIL') { failed = true; }
    const suffix = verdict === 'FAIL'
      ? (detail ? ` — ${oneLine(detail)}` : '')
      : (detail ? ` (${oneLine(detail)})` : '');
    fs.appendFileSync(file, `${verdict}  ${oneLine(name)}${suffix}\n`);
  }

  return {
    file,
    /**
     * @param {string} name - step label
     * @param {string} [detail] - the step's own detail line, when it returned one
     */
    pass: (name, detail) => record('PASS', name, detail),
    /**
     * @param {string} name - step label
     * @param {Error|string} [error] - what broke, flattened onto the same line
     */
    fail: (name, error) => record('FAIL', name, reasonText(error)),
    /**
     * Record a death that no step explains — the runner aborted BEFORE or
     * OUTSIDE step(): a preflight guard (a live stack holding the ports), a
     * harness throw on the way up. Without this the file holds only a header
     * and the reason lives in a console nobody kept.
     *
     * A no-op once a step has failed: that error is the recorded verdict
     * propagating out of the runner, not a second, unexplained failure.
     *
     * @param {Error|string} reason - why the run never reached its steps
     */
    abort: (reason) => { if (!failed) { record('FAIL', 'preflight', reasonText(reason)); } },
  };
}

module.exports = { createStepsLog };
