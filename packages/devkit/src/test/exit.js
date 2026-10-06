/**
 * How a test entry ends its process: `exitFlushed(code)` marks the report
 * written and exits once both streams flush, so a handle a suite left open
 * cannot hold the process and a json document on a pipe is never cut short;
 * `guardEarlyExit()` fails a process that a case ends before that.
 */

const fs = require('fs');

// Set by exitFlushed alone: any other way out of the process is an early end.
let reported = false;

/**
 * Mark the report written, flush stdout, then stderr, then exit with `code`.
 * @param {number} code - The exit code.
 * @returns {void}
 */
function exitFlushed(code) {
  reported = true;
  process.exitCode = code;
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
}

/**
 * On exit, a run that did not end through `exitFlushed` fails, with a line on stderr.
 * @returns {void}
 */
function guardEarlyExit() {
  process.on('exit', () => {
    if (reported) return;
    fs.writeSync(2, 'The test run ended before its report was written.\n');
    process.exitCode = 1;
  });
}

module.exports = { exitFlushed, guardEarlyExit };
