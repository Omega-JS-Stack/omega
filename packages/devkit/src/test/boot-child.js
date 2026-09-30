/**
 * The ONE way an e2e lane boots a long-running child of the local stack —
 * the emulator, `omega dev` — and the ONE way it stops one.
 *
 * A browser lane is only as honest as the stack behind it, and the stack is
 * two children that take minutes to become useful. Both halves are subtle
 * enough that every copy of them drifted: the READY MARKER is what a lane
 * waits on (never a sleep, never "the port answers" — the emulator's port
 * answers a full persona wipe before it answers a test), the output is teed
 * to a log file as it arrives (so a lane that dies mid-boot leaves the reason
 * on disk), and the stop is a process-GROUP SIGINT with a SIGKILL fallback,
 * because firebase-tools and the dev server both spawn children of their own
 * that a bare `child.kill()` orphans.
 *
 * The hoisted local bin is spawned DIRECTLY (never via npx): outside an
 * npm-script PATH the npx shim routes through the Socket Firewall proxy,
 * whose proxy env breaks firebase-tools' internal emulator REST calls.
 */

// Libraries
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// How long a clean SIGINT gets before the group is killed outright.
const STOP_GRACE = 20000;

// How long a dead child's pipes get to reach EOF before the tee ends: a
// grandchild that inherited them can hold them open past the child's death.
const DRAIN_GRACE = 1000;

/**
 * Resolve with the exit code once the child has exited, its pipes are read
 * to EOF (or DRAIN_GRACE passed and they were dropped), and the log stream
 * has finished, so a caller reading the log sees every byte the child wrote.
 *
 * @param {object} child - A spawned child with piped stdout and stderr
 * @param {object} logStream - The write stream its output is teed to
 * @returns {Promise<number|null>}
 */
function afterExit(child, logStream) {
  return new Promise((resolve) => {
    child.once('exit', (code) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(cap);
        child.stdout.destroy();
        child.stderr.destroy();
        logStream.end(() => resolve(code));
      };
      const cap = setTimeout(finish, DRAIN_GRACE);
      child.once('close', finish);
    });
  });
}

/**
 * Spawn a long-running child, teeing its output to a log file, and resolve
 * when its ready marker appears.
 *
 * @param {object} options
 * @param {string} options.bin - Executable (an absolute path to a local bin)
 * @param {string[]} options.args - Arguments
 * @param {string} options.cwd - Working directory
 * @param {object} [options.env] - Environment (defaults to this process's)
 * @param {string} options.logFile - Log path (created, truncated per run)
 * @param {RegExp} options.marker - Ready marker; capture group 1 is resolved
 * @param {number} options.timeout - ms before giving up
 * @param {string} [options.relativeTo] - Root the log path is reported against
 * @returns {{ child: object, ready: Promise<string|null> }}
 */
function startChild({ bin, args, cwd, env, logFile, marker, timeout, relativeTo }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logStream = fs.createWriteStream(logFile);
  const reportedLog = path.relative(relativeTo || process.cwd(), logFile);

  const child = spawn(bin, args, {
    cwd,
    env: env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const ready = new Promise((resolve, reject) => {
    // Buffered, not per-chunk: a marker can straddle two reads, and a lane
    // that misses it waits out the whole timeout for a stack that IS up.
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`${path.basename(bin)} ${args[0]} not ready after ${timeout / 1000}s (log: ${reportedLog})`));
    }, timeout);

    const watch = (chunk) => {
      const text = chunk.toString();
      buffer += text;
      const match = buffer.match(marker);
      if (!match) {
        logStream.write(text);
        return;
      }
      // Resolve only once the chunk that carried the marker has reached the
      // file: a caller reading the log right after `ready` sees the marker
      // line, not a tee still in flight (the battery's parallel load showed
      // the gap).
      logStream.write(text, () => {
        clearTimeout(timer);
        resolve(match[1] || null);
      });
    };

    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', () => clearTimeout(timer));
    afterExit(child, logStream).then((code) => {
      reject(new Error(`${path.basename(bin)} ${args[0]} exited early (code ${code}, log: ${reportedLog})`));
    });
  });

  return { child, ready };
}

/**
 * Stop a child started by startChild — its whole process group, clean first.
 *
 * @param {object} child - The child from startChild
 * @param {object} [options]
 * @param {number} [options.grace] - ms a clean SIGINT gets before SIGKILL
 * @returns {Promise<void>}
 */
async function stopChild(child, { grace = STOP_GRACE } = {}) {
  if (!child || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { process.kill(-child.pid, 'SIGINT'); } catch (e) { return; }

  // The grace timer is CLEARED on a clean exit, never left to fire: this
  // module runs inside node:test files too, where a dangling 20s timer holds
  // the event loop open long after the suite is done.
  let graceTimer = null;
  const expired = new Promise((resolve) => { graceTimer = setTimeout(() => resolve('expired'), grace); });
  const result = await Promise.race([exited.then(() => 'clean'), expired]);
  clearTimeout(graceTimer);

  if (result !== 'clean') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
  }
}

module.exports = { startChild, stopChild, afterExit, STOP_GRACE };
