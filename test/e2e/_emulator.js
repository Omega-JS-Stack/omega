/**
 * The ONE playground emulator boot the root lanes share: the playground
 * backend's `mgr emulator`, teed to `<logDir>/emulator.log`, ready on the
 * CLI's post-seed marker, stopped as a process group. It stands on devkit's
 * `boot-child`, and it never clobbers a live playground stack: a taken
 * hosting port from the playground's ports file is someone's dev session.
 */
const path = require('path');
const fs = require('fs');
const { readPortsFile, isPortFree } = require('@omega.js/config');
const { startChild, stopChild } = require('@omega.js/devkit/test/boot-child');
const { EMULATOR_READY_MARKER } = require('@omega.js/devkit/test/e2e-harness');

const ROOT = path.join(__dirname, '..', '..');
const PLAYGROUND_BACKEND = path.join(ROOT, 'brands', 'playground-omega', 'targets', 'backend');
const MGR_BIN = path.join(ROOT, 'node_modules', '.bin', 'mgr');
const READY_TIMEOUT = 240000;

/**
 * The playground's Firebase project id, from its `.firebaserc`.
 * @returns {string}
 */
function playgroundProjectId() {
  return JSON.parse(fs.readFileSync(path.join(PLAYGROUND_BACKEND, '.firebaserc'), 'utf8')).projects.default;
}

/**
 * Refuse, by name, when a playground emulator stack is already running.
 * @returns {Promise<void>}
 */
async function assertNoLivePlayground() {
  const incumbent = readPortsFile(PLAYGROUND_BACKEND);
  if (incumbent?.hosting && !(await isPortFree(incumbent.hosting))) {
    throw new Error(`a playground emulator stack is already running (hosting :${incumbent.hosting}): stop it and re-run`);
  }
}

/**
 * Boot the playground emulator and resolve once it is ready.
 * @param {object} options
 * @param {string} options.logDir - The lane's log dir; the emulator tees to `emulator.log` there.
 * @param {string[]} [options.args] - Flags after `mgr emulator` (`--no-https`, `--no-seed`).
 * @param {object} [options.env] - The child's environment (defaults to this process's).
 * @param {number} [options.timeout] - ms to wait for the ready marker.
 * @returns {Promise<{ child: object, ports: object }>} The child and the ports file it published.
 */
async function startPlaygroundEmulator({ logDir, args = [], env, timeout = READY_TIMEOUT }) {
  await assertNoLivePlayground();

  const { child, ready } = startChild({
    bin: MGR_BIN,
    args: ['emulator', ...args],
    cwd: PLAYGROUND_BACKEND,
    env,
    logFile: path.join(logDir, 'emulator.log'),
    marker: EMULATOR_READY_MARKER,
    timeout,
    relativeTo: ROOT,
  });

  try {
    await ready;
  } catch (error) {
    await stopChild(child);
    throw error;
  }

  const ports = readPortsFile(PLAYGROUND_BACKEND);
  if (!ports?.hosting || !ports?.auth || !ports?.firestore || !ports?.functions) {
    await stopChild(child);
    throw new Error(`resolved port map incomplete: ${JSON.stringify(ports)}`);
  }
  return { child, ports };
}

/**
 * Stop the emulator's whole process group: SIGINT, 20 s, then SIGKILL.
 * @param {object} [child] - The child startPlaygroundEmulator resolved
 * @returns {Promise<void>}
 */
function stopPlaygroundEmulator(child) {
  return stopChild(child);
}

module.exports = { startPlaygroundEmulator, stopPlaygroundEmulator, assertNoLivePlayground, playgroundProjectId, PLAYGROUND_BACKEND };
