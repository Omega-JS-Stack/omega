/**
 * What every desktop app-row driver does with the Electron child it spawns:
 * resolve the binary, read the child's envelope lines back into case events,
 * pass its other output through, wait for its end, and end it on `stop()`.
 */

const chalk = require('chalk').default;
const { parseEventLine } = require('@omega.js/devkit/test/events');

const NO_ELECTRON_REASON = 'Electron is not installed in this project';

// How long a child gets to go down politely before SIGKILL.
const KILL_GRACE_MS = 2000;

// How many stderr lines a crashed child's report quotes.
const STDERR_TAIL = 20;

// How long a dead child's pipes get to deliver their last lines before its end counts.
const DRAIN_GRACE_MS = 1000;

/**
 * The Electron binary, resolved the way Node resolves from `root` (hoisted installs included).
 * @param {string} root - The project root.
 * @returns {string|null} The binary path, or null when Electron is not installed.
 */
function resolveElectron(root) {
  try {
    return require(require.resolve('electron', { paths: [root] }));
  } catch (e) {
    return null;
  }
}

/**
 * Read a child's output: each envelope line on stdout is `onEvent(event)`, and
 * every other line, stdout and stderr alike, passes through to stdout; the last
 * stderr lines are kept for a crash report.
 * @param {object} child - A spawned child with piped stdout and stderr.
 * @param {Function} onEvent - Called with each case event.
 * @returns {{tail: Function, detach: Function}} `tail()` is the last stderr lines; `detach()` stops reading.
 */
function readChildOutput(child, onEvent) {
  let buffer = '';
  const stderrLines = [];

  function onStdout(chunk) {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const event = parseEventLine(line);
      if (event) onEvent(event);
      else if (line.trim().length > 0) process.stdout.write(chalk.gray(`      ${line}\n`));
    }
  }

  function onStderr(chunk) {
    const lines = chunk.toString().split('\n').filter((line) => line.trim().length > 0);
    lines.forEach((line) => process.stdout.write(chalk.gray(`      [stderr] ${line}\n`)));
    stderrLines.push(...lines);
    stderrLines.splice(0, Math.max(0, stderrLines.length - STDERR_TAIL));
  }

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  return {
    tail: () => stderrLines.join('\n'),
    detach() {
      child.stdout.removeListener('data', onStdout);
      child.stderr.removeListener('data', onStderr);
    },
  };
}

/**
 * Resolve once the child has exited and its pipes delivered their last lines
 * (bounded: a grandchild that inherited them can hold them open).
 * @param {object} child - A spawned child.
 * @returns {Promise<{code: number|null, signal: string|null}>} Rejects when the spawn itself fails.
 */
function childEnded(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.once('exit', (code, signal) => {
      const done = () => resolve({ code, signal });
      const grace = setTimeout(done, DRAIN_GRACE_MS);
      child.once('close', () => {
        clearTimeout(grace);
        done();
      });
    });
  });
}

/**
 * The error of a child that exited non-zero, quoting the tail of its stderr.
 * @param {string} layer - The layer the child ran.
 * @param {{code: number|null, signal: string|null}} end - How it ended.
 * @param {string} tail - Its last stderr lines.
 * @returns {Error} The error.
 */
function exitError(layer, { code, signal }, tail) {
  const how = signal ? `on ${signal}` : `with code ${code}`;
  return new Error(`the ${layer} app exited ${how}${tail ? `:\n${tail}` : ''}`);
}

/**
 * End a child still running: polite first, then SIGKILL. The grace timer is
 * unref'd so it never holds the runner open on its own.
 * @param {object} child - A spawned child.
 * @param {number} killGraceMs - How long the polite end gets.
 * @returns {void}
 */
function endChild(child, killGraceMs) {
  try { child.kill(); } catch (e) { /* already gone */ }
  const grace = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
  }, killGraceMs);
  if (typeof grace.unref === 'function') grace.unref();
}

module.exports = { NO_ELECTRON_REASON, KILL_GRACE_MS, resolveElectron, readChildOutput, childEnded, exitError, endChild };
