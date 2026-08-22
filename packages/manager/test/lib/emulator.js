/**
 * The throwaway Firestore emulator every manager server-truth lane boots
 * (directory #246, migrations #428) — one free port, one temp project dir, and
 * a teardown that actually lets node exit (#440).
 *
 * The teardown is why this is shared. `firebase emulators:start` is a CLI
 * wrapped around a java emulator it spawns DETACHED, and a SIGTERM aimed at
 * the CLI's pid alone is not enough to get every holder of these pipes to let
 * go: the lane goes green, the readable never ends, and node sits there
 * instead of exiting (one manager run hung ~25 minutes at teardown, #440). So
 * the child is spawned detached as its own process GROUP, and stopProcessGroup
 * signals the group, backstops with SIGKILL, and destroys the pipes itself.
 *
 * That still does not GUARANTEE the java emulator dies (#460): firebase-tools
 * spawns it detached too, in a group of its own, so no group signal can ever
 * reach it. The stop path therefore ends in a collection pass that proves which
 * JVM is this lane's and terminates it — see collectStrayEmulators.
 *
 * The lanes SKIP (never fail) without the firebase CLI or a JVM, matching how
 * every other emulator-dependent lane in this repo handles a missing tool.
 */
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { realpathSync } = require('node:fs');
const net = require('node:net');
const { join } = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const jetpack = require('fs-jetpack');

const LOG_TAG = '[@omega.js/manager:test:emulator]';

const READY_TIMEOUT_MS = Number(process.env.OMEGA_EMULATOR_READY_TIMEOUT || 180000);
const HARD_KILL_AFTER_MS = 15000;
const COLLECT_LOOKUP_TIMEOUT_MS = 5000;
const COLLECT_GRACE_MS = 2000;
const COLLECT_KILL_TIMEOUT_MS = 2000;

// ─── Tool availability ───────────────────────────────────────────────────────

/** @returns {string|null} Why an emulator lane cannot run, or null when it can. */
function missingTool() {
  const firebase = spawnSync('firebase', ['--version'], { stdio: 'ignore' });
  if (firebase.error || firebase.status !== 0) {
    return 'the firebase CLI is not on PATH';
  }

  const java = spawnSync('java', ['-version'], { stdio: 'ignore' });
  if (java.error || java.status !== 0) {
    return 'no JVM is installed (the Firestore emulator is a java process)';
  }

  return null;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * SIGTERM a detached child's whole process GROUP, SIGKILL the group if that is
 * not enough, then destroy the pipes — whatever still holds their far end must
 * not keep this process alive.
 *
 * @param {import('node:child_process').ChildProcess} child - A group leader (spawned `detached: true`).
 * @param {number} hardKillAfterMs - How long SIGTERM gets before SIGKILL.
 * @returns {Promise<void>} Resolves once the group is gone and the pipes are released.
 */
function signalGroup(child, hardKillAfterMs) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(hard);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve();
    };

    const hard = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch { /* already gone */ }
      done();
    }, hardKillAfterMs);

    child.once('exit', done);

    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      done();
    }
  });
}

// ─── Collection (#460) ───────────────────────────────────────────────────────

/** @returns {boolean} True while the pid still answers (EPERM answers: alive, just not ours). */
function alive(pid) {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** @returns {Promise<boolean>} True once the pid stops answering, or false at the deadline. */
async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!alive(pid)) {
      return true;
    }
    await sleep(50);
  }

  return !alive(pid);
}

/**
 * Read a bounded line of process table, or nothing at all.
 *
 * BOUNDED because a discovery step that hangs would hold the lane open forever,
 * which is the very failure this file exists to prevent (and plain `lsof` does
 * exactly that on this machine's smbfs mount — pgrep/ps read the process table,
 * never the filesystem). An overrun names NOBODY, and a process the discovery
 * cannot name is spared: the bound can only ever spare a process, never take one.
 * @param {string} file - `pgrep` or `ps`.
 * @param {string[]} args - Its arguments (no shell — the bound must land on the tool itself).
 * @returns {string} The trimmed stdout, or '' when the read fails or overruns.
 */
function readProcessTable(file, args) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: COLLECT_LOOKUP_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    }).trim();
  } catch {
    return '';
  }
}

/**
 * The two shapes a lane's temp dir can wear on a command line: the path the
 * lane holds, and the one the OS hands its children (macOS resolves /var to
 * /private/var the moment the emulator reads its own cwd).
 * @param {string} dir - The lane's temp project dir.
 * @returns {string[]}
 */
function dirForms(dir) {
  try {
    return [...new Set([dir, realpathSync(dir)])];
  } catch {
    return [dir];
  }
}

/**
 * Collect the java emulator this lane's CLI left behind.
 *
 * firebase-tools spawns the emulator DETACHED, in its own process group, so the
 * group signal above can never reach it: when the CLI dies before its graceful
 * shutdown finishes, the JVM leaks and keeps its port (22 strays proved it, #460).
 *
 * OWNERSHIP IS PROVEN, NEVER ASSUMED. A pid is this lane's only when its live
 * command line carries BOTH `--project_id <this lane's demo project>` AND this
 * lane's own temp dir (the `--rules` path). The project id alone would name
 * every run of the same lane ever left on the machine — other people's strays,
 * a parallel run's live emulator — so a process that matches the project but
 * not the dir is REPORTED and left running. `java` or the jar name alone is
 * never a match at all.
 * @param {object} options - The lane's identity.
 * @param {string} options.projectId - The demo-* project this lane's emulator serves.
 * @param {string} options.dir - The lane's throwaway project dir.
 * @param {number} [options.graceMs] - How long SIGTERM gets before SIGKILL.
 * @returns {Promise<{collected: number[], spared: number[]}>} What died, and what was left alone.
 */
async function collectStrayEmulators({ projectId, dir, graceMs = COLLECT_GRACE_MS }) {
  const forms = dirForms(dir);
  // pid 0 is not a pid — it is "every process in MY group", and a `map(Number)`
  // over an empty read hands it right to the kill below.
  const candidates = readProcessTable('pgrep', ['-f', projectId])
    .split('\n')
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

  const collected = [];
  const spared = [];

  for (const pid of candidates) {
    // The flag and its value as SEPARATE argv words: a substring would read
    // `--project_id demo-omega-x-2` as a match for `demo-omega-x`.
    const argv = readProcessTable('ps', ['-o', 'command=', '-p', String(pid)]).split(/\s+/);
    const flag = argv.indexOf('--project_id');
    if (flag === -1 || argv[flag + 1] !== projectId) {
      continue;
    }

    const command = argv.join(' ');

    if (!forms.some((form) => command.includes(form))) {
      spared.push(pid);
      continue;
    }

    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      continue; // it went down with the CLI after all
    }

    if (!await waitForExit(pid, graceMs)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch { /* already gone */ }
      await waitForExit(pid, COLLECT_KILL_TIMEOUT_MS);
    }

    collected.push(pid);
  }

  if (collected.length) {
    console.warn(`${LOG_TAG} collected ${collected.length} leaked ${projectId} emulator(s): ${collected.join(', ')}`);
  }

  if (spared.length) {
    console.warn(`${LOG_TAG} left ${spared.length} ${projectId} emulator(s) this lane cannot prove are its own: ${spared.join(', ')}`);
  }

  return { collected, spared };
}

/**
 * Stop a lane's emulator for good: signal the CLI's process group, then collect
 * the detached java emulator the group signal cannot reach.
 *
 * @param {import('node:child_process').ChildProcess} child - A group leader (spawned `detached: true`).
 * @param {object} [options] - Teardown options.
 * @param {number} [options.hardKillAfterMs] - How long SIGTERM gets before SIGKILL.
 * @param {{projectId: string, dir: string}} [options.collect] - The lane identity the collection pass proves ownership with.
 * @returns {Promise<{collected: number[], spared: number[]}>} What the collection pass killed, and what it left alone.
 */
async function stopProcessGroup(child, { hardKillAfterMs = HARD_KILL_AFTER_MS, collect = null } = {}) {
  await signalGroup(child, hardKillAfterMs);

  if (!collect) {
    return { collected: [], spared: [] };
  }

  return collectStrayEmulators(collect);
}

/**
 * Boot a standalone Firestore emulator in its own throwaway project dir.
 *
 * @param {object} options - Which emulator to boot.
 * @param {string} options.projectId - The demo-* project the emulator serves.
 * @param {string} options.prefix - Temp-dir prefix, so a stray dir names its lane.
 * @returns {Promise<{ port: number, dir: string, stop: Function }>}
 */
async function startEmulator({ projectId, prefix }) {
  const port = await freePort();
  const dir = jetpack.tmpDir({ prefix }).cwd();

  jetpack.write(join(dir, 'firebase.json'), {
    emulators: { firestore: { host: '127.0.0.1', port }, ui: { enabled: false } },
    firestore: { rules: 'firestore.rules' },
  });
  // These lanes are server-side tooling on a service account; client access is
  // denied exactly as the real projects' rules deny it.
  jetpack.write(
    join(dir, 'firestore.rules'),
    'rules_version = "2";\nservice cloud.firestore {\n  match /databases/{db}/documents {\n    match /{document=**} { allow read, write: if false; }\n  }\n}\n',
  );

  const child = spawn(
    'firebase',
    ['emulators:start', '--only', 'firestore', '--project', projectId],
    { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );

  const output = [];
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Firestore emulator never reported ready in ${READY_TIMEOUT_MS}ms:\n${output.join('')}`)),
      READY_TIMEOUT_MS,
    );

    const watch = (chunk) => {
      output.push(String(chunk));
      if (output.join('').includes('All emulators ready')) {
        clearTimeout(timer);
        resolve();
      }
    };

    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Firestore emulator exited with code ${code}:\n${output.join('')}`));
    });
  });

  await ready;

  return { port, dir, stop: () => stopProcessGroup(child, { collect: { projectId, dir } }) };
}

module.exports = { collectStrayEmulators, missingTool, startEmulator, stopProcessGroup };
