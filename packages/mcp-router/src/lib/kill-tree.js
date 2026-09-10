/**
 * Killing a child and everything it started.
 *
 * The pid the router holds is often only the ROOT of a tree: `npx` starts npm,
 * which starts the real server, which starts a browser. Signalling that one
 * pid ends the wrapper and REPARENTS the rest to init, out of reach of anything
 * the router knows — which is how a stopped upstream leaves a browser burning
 * cores for the rest of the day. So the tree is walked and signalled deepest
 * first, while the links between the processes still exist to be read.
 */

const { execFileSync } = require('node:child_process');

/**
 * The direct children of one process.
 *
 * @param {number} pid - Parent pid
 * @returns {number[]} Child pids, empty when there are none to find
 */
const childPids = (pid) => {
  try {
    return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((child) => Number.isInteger(child) && child > 0);
  } catch {
    // pgrep exits 1 when nothing matches, which execFileSync raises; a platform
    // with no pgrep at all answers the same way. Either is "no children we can
    // see", and the pid itself is still signalled by the caller.
    return [];
  }
};

/**
 * Every descendant of one process, deepest first.
 *
 * One level is never enough for a capture: the MIDDLE of a tree exits with the
 * root above it, and the browser it started is reparented and invisible to any
 * walk by the time a grace period runs. The tree has to be read whole while it
 * is still a tree.
 *
 * @param {number} pid - Root pid, itself not included
 * @returns {number[]} Descendant pids, deepest first, empty when there are none
 */
const descendantPids = (pid) => {
  const found = [];
  for (const child of childPids(pid)) found.push(...descendantPids(child), child);
  return found;
};

/**
 * Signal a process and every descendant, deepest first.
 *
 * Deepest first is what makes it a tree kill rather than a race: a parent
 * signalled first would take its links with it and leave the rest unreachable.
 *
 * @param {number} pid - Root pid of the tree
 * @param {string|number} signal - Signal to send (e.g. 'SIGKILL')
 * @returns {void}
 * @throws {Error} Whatever process.kill rejected with, except ESRCH
 */
const killTree = (pid, signal) => {
  for (const child of childPids(pid)) killTree(child, signal);

  try {
    process.kill(pid, signal);
  } catch (err) {
    // ESRCH is the process having exited on its own between the walk and the
    // signal — the outcome we wanted. Anything else (EPERM) is a real problem.
    if (err.code !== 'ESRCH') throw err;
  }
};

module.exports = { descendantPids, killTree };
