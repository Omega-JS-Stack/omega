/**
 * Test: a port taken between the probe and the bind bumps and retries once
 * ([#778](https://github.com/Omega-JS-Stack/omega/issues/778)).
 *
 * The allocator probes, then firebase-tools binds: two moments, and on a
 * machine running a second brand's stack a foreign listener fits between them.
 * The boot then died on `listen EADDRINUSE 127.0.0.1:9099` and took every
 * emulator-backed step of the lane with it. So a bind failure re-allocates
 * around the port that failed, republishes the map, and boots ONE more time;
 * a second failure is the report, naming the port and whoever holds it.
 *
 * Run: npx omega test backend:cli/emulator-port-retry
 *
 * Nothing here spawns an emulator or signals anything: `spawn` itself is a
 * fixture for the duration of each boot, the ports are a throwaway map nowhere
 * near the classic ones, and the reap case reads the world through the same
 * injected `ps`/kill/probe seams the stale-reap suite uses.
 */
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { EventEmitter } = require('events');
const jetpack = require('fs-jetpack');

const EmulatorCommand = require('../../dist/cli/commands/emulator.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const OURS = 'demo-sandbox-brand';

// A real row from `ps -o command=` against a booted sandbox emulator.
const FIRESTORE_JAR = `java -jar cloud-firestore-emulator-v1.21.0.jar --host 127.0.0.1 --port 8080 --project_id ${OURS}`;

// Where a dead run's survivors are parented.
const ORPHANED = 1;

// Every emulator this project declares. All eight, because a name missing from
// firebase.json falls back to the CLASSIC port, and a fixture must never send
// the allocator at the ports a real stack on this machine is using.
const EMULATOR_NAMES = ['auth', 'functions', 'firestore', 'database', 'hosting', 'storage', 'pubsub', 'ui'];

/**
 * A throwaway backend target whose emulator ports are nowhere near the classic
 * map, spaced out so a bump of one name cannot collide with the next.
 */
function makeProject() {
  const projectDir = path.join(os.tmpdir(), `omega-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const base = 49100 + Math.floor(Math.random() * 300) * 10;

  jetpack.write(path.join(projectDir, 'firebase.json'), JSON.stringify({
    emulators: Object.fromEntries(EMULATOR_NAMES.map((name, index) => [name, { port: base + index * 10 }])),
  }, null, 2));

  return { projectDir, cleanup: () => jetpack.remove(projectDir) };
}

/** The `firebase emulators:start` child, as a fixture: no shell, no ports, no pid to signal. */
function fixtureChild() {
  const child = new EventEmitter();

  child.pid = -1;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;

  return child;
}

/**
 * An emulator command over a throwaway project with every path that touches a
 * REAL process stubbed out: the port-driven reaper, the preflight sweep, the
 * pid record and the stop path's sweep all signal live pids on live ports.
 * @param {string} projectDir - The throwaway project.
 */
function bootCommand(projectDir) {
  const command = new EmulatorCommand({ firebaseProjectPath: projectDir, argv: { https: false, seed: false }, options: {} });
  const lines = [];

  command.log = (message) => lines.push(String(message));
  command.logWarning = (message) => lines.push(String(message));
  command.ensureStaged = () => {};
  command.startStageWatch = () => ({ close: () => {} });
  command.reapMachineOrphans = async () => {};
  command.reapStaleRecordedProcesses = async () => {};
  command.preflightEmulatorPorts = async () => [];
  command.writeEmulatorPidRecord = () => [];
  command.terminateRecordedEmulatorProcesses = async () => {};

  return { command, lines };
}

/**
 * Run `fn` with the given fixture standing in for `child_process.spawn`.
 *
 * The boot reaches spawn through `cli/utils/spawn-shell.js`, which reads
 * `childProcess.spawn` at CALL time
 * ([#769](https://github.com/Omega-JS-Stack/omega/issues/769)), so the stand-in
 * is installed for the DURATION of the boot and taken straight back out.
 * @param {Function} spawn - Stands in for child_process.spawn.
 * @param {Function} fn - What runs while it stands in.
 */
async function withSpawn(spawn, fn) {
  const realSpawn = childProcess.spawn;

  childProcess.spawn = spawn;

  try {
    return await fn();
  } finally {
    childProcess.spawn = realSpawn;
  }
}

/** The OMEGA_*_PORT block a boot publishes, snapshotted so a case can put it back. */
function capturePortEnv() {
  const keys = Object.keys(process.env).filter((key) => /^OMEGA_.*_PORT$/.test(key));
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  return () => {
    for (const key of Object.keys(process.env)) {
      if (/^OMEGA_.*_PORT$/.test(key) && !(key in prior)) delete process.env[key];
    }
    Object.assign(process.env, prior);
  };
}

/** The published map this boot handed its child, as the child reads it. */
function publishedPorts(projectDir) {
  return jetpack.read(path.join(projectDir, '.temp', 'ports.json'), 'json')?.ports || {};
}

/**
 * A child that dies the way firebase-tools does when its auth port went to
 * somebody else: the bind failure on stderr, then gone. The port defaults to
 * the one the boot just published, so the fixture always names the port THIS
 * attempt was actually given.
 * @param {object} [options]
 * @param {number} [options.port] - The port the failure names.
 * @param {boolean} [options.close] - Emit `close` (false = the late-close case:
 *   the child outlives shutdown's races and the event lands after the retry).
 */
function bindFailureChild({ port, close = true } = {}) {
  const child = fixtureChild();

  setImmediate(() => {
    // Dead before the boot can signal it: a stack that never bound anything
    // has no process group to take down.
    child.exitCode = 1;
    child.stderr.emit('data', Buffer.from(`⚠  emulators: Error: listen EADDRINUSE: address already in use 127.0.0.1:${port || process.env.OMEGA_AUTH_PORT}\n`));

    if (close) {
      child.emit('close', 1, null);
    }
  });

  return child;
}

/** A child that comes up. */
function readyChild() {
  const child = fixtureChild();

  setImmediate(() => child.stdout.emit('data', Buffer.from('[fixture] All emulators ready\n')));

  return child;
}

module.exports = defineCases({
  description: 'emulator boot bumps and retries once when a port is taken mid-bind',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-port-taken-mid-bind-is-bumped-and-the-boot-retried-once',
      async run({ assert }) {
        const { projectDir, cleanup } = makeProject();
        const { command } = bootCommand(projectDir);
        const restoreEnv = capturePortEnv();
        const attempts = [];
        let child = null;

        const fixtureSpawn = () => {
          attempts.push(Number(process.env.OMEGA_AUTH_PORT));
          child = attempts.length === 1 ? bindFailureChild() : readyChild();
          return child;
        };

        try {
          const { emulatorPorts, bumped } = await withSpawn(fixtureSpawn, () => command.startEmulators({ https: false }));

          assert.equal(attempts.length, 2, 'the first boot died on the bind and exactly one retry followed');
          assert.equal(attempts[1], attempts[0] + 1, 'the retry allocated auth off the port it could not bind');
          assert.equal(emulatorPorts.auth, attempts[1], 'the stack that came up is the bumped one');
          assert.ok(bumped.includes('auth'), 'the moved name is reported as bumped');
          assert.equal(publishedPorts(projectDir).auth, attempts[1], 'the ports file siblings read carries the bumped port');
          assert.equal(publishedPorts(projectDir).functions, emulatorPorts.functions, 'every other name kept its allocation');
        } finally {
          if (child) child.emit('close', 0, null);
          restoreEnv();
          cleanup();
        }
      },
    },

    {
      name: 'a-bind-failure-on-a-port-this-run-never-asked-for-is-not-retried',
      async run({ assert }) {
        // The retry is for the race this run can do something about: a port of
        // its OWN allocation. A failure naming anything else (a redis this
        // machine runs, a port some other tool logged) is not a bump the
        // allocator can make, so the boot fails the way it always did.
        const { projectDir, cleanup } = makeProject();
        const { command } = bootCommand(projectDir);
        const restoreEnv = capturePortEnv();
        const attempts = [];
        let failure = null;

        const fixtureSpawn = () => {
          attempts.push(Number(process.env.OMEGA_AUTH_PORT));
          return bindFailureChild({ port: 6379 });
        };

        try {
          await withSpawn(fixtureSpawn, () => command.startEmulators({ https: false }));
        } catch (error) {
          failure = error;
        }

        try {
          assert.equal(attempts.length, 1, 'a port outside the allocation is not a bump, so nothing is retried');
          assert.equal(failure?.addressInUsePort, undefined, 'the failure carries no port tag');
          assert.match(failure.message, /exited before ready/, 'the boot fails the way it always did');
        } finally {
          restoreEnv();
          cleanup();
        }
      },
    },

    {
      name: 'a-late-close-from-the-failed-attempt-leaves-the-retrys-artifacts-alone',
      async run({ assert }) {
        // The first child can outlive shutdown's SIGTERM/SIGKILL races and
        // close LATER, by which time the retry has published its own map into
        // the same two files. Both attempts stamp this same process, so only
        // the attempt token can tell the closing one it is no longer in charge.
        const { projectDir, cleanup } = makeProject();
        const { command } = bootCommand(projectDir);
        const restoreEnv = capturePortEnv();
        const children = [];
        const resolvedConfig = path.join(projectDir, 'firebase.resolved.json');

        const fixtureSpawn = () => {
          const child = children.length === 0 ? bindFailureChild({ close: false }) : readyChild();
          children.push(child);
          return child;
        };

        try {
          const { emulatorPorts } = await withSpawn(fixtureSpawn, () => command.startEmulators({ https: false }));

          assert.equal(publishedPorts(projectDir).auth, emulatorPorts.auth, 'the retry published its map');

          // The dead first attempt finally reports in.
          children[0].emit('close', 1, null);

          assert.equal(publishedPorts(projectDir).auth, emulatorPorts.auth, "the late close leaves the live stack's ports file published");
          assert.ok(jetpack.exists(resolvedConfig), 'and leaves the config the live stack is running on');
        } finally {
          children.forEach((child) => child.emit('close', 0, null));
          restoreEnv();
          cleanup();
        }
      },
    },

    {
      name: 'a-second-bind-failure-names-the-port-and-its-holder',
      async run({ assert }) {
        // Twice on the same wall is not a race any more: something is sitting
        // on that port. The report says which, and who has it, and never
        // signals them.
        const { projectDir, cleanup } = makeProject();
        const { command } = bootCommand(projectDir);
        const restoreEnv = capturePortEnv();
        const attempts = [];
        const asked = [];
        let failure = null;

        command.describePortHolders = (port) => {
          asked.push(port);
          return [{ pid: 4242, command: FIRESTORE_JAR }];
        };

        const fixtureSpawn = () => {
          attempts.push(Number(process.env.OMEGA_AUTH_PORT));
          return bindFailureChild();
        };

        try {
          await withSpawn(fixtureSpawn, () => command.startEmulators({ https: false }));
        } catch (error) {
          failure = error;
        }

        try {
          assert.ok(failure, 'a boot that cannot bind its ports twice fails loudly');
          assert.equal(attempts.length, 2, 'ONE retry, never a loop');
          assert.deepEqual(asked, [attempts[1]], 'the holder is looked up for the port the retry could not bind');
          assert.match(failure.message, new RegExp(`port ${attempts[1]} \\(auth\\)`), 'the report names the port and the emulator that wanted it');
          assert.match(failure.message, /held by pid 4242: java -jar cloud-firestore-emulator/, 'and the process holding it');
        } finally {
          restoreEnv();
          cleanup();
        }
      },
    },

    {
      name: 'the-stale-reap-probes-its-ports-only-after-the-pid-is-gone',
      async run({ assert }) {
        // A signal is not an exit: kill() returns while the kernel is still
        // unwinding the process, so a probe in that same tick is a verdict
        // about a shutdown that has not happened. The numbers go first, then
        // the ports, and the port poll keeps asking until it reads free.
        const projectDir = path.join(os.tmpdir(), `omega-retry-reap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const command = new EmulatorCommand({ firebaseProjectPath: projectDir, argv: {}, options: {} });
        const lines = [];
        const events = [];
        const port = 49999;
        let sigkilled = false;
        let readsAfterKill = 0;
        let probes = 0;

        command.log = (message) => lines.push(String(message));
        command.logWarning = (message) => lines.push(String(message));

        jetpack.write(command.getTempPath('emulator-pids.json'), {
          pids: [4001, 4002],
          projectId: OURS,
          rootPid: 4001,
          ports: { firestore: port },
          startedAt: new Date().toISOString(),
        });

        // 4001 (the dead run's root) is gone; 4002 is its orphaned jar, and it
        // ignores SIGTERM, keeps reading alive for one poll past the SIGKILL,
        // and holds its listener for one probe past that.
        const seams = {
          readProcess: (pid) => {
            if (Number(pid) !== 4002) {
              return null;
            }

            if (sigkilled) {
              readsAfterKill++;

              if (readsAfterKill > 1) {
                events.push('gone');
                return null;
              }

              events.push('unwinding');
            }

            return { ppid: ORPHANED, command: FIRESTORE_JAR };
          },
          kill: (pid, signal) => {
            events.push(`signal:${signal}`);
            sigkilled = sigkilled || signal === 'SIGKILL';
          },
          isFree: async (probed) => {
            events.push(`probe:${probed}`);
            probes++;
            return probes > 1;
          },
        };

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), seams);

          assert.deepEqual(
            events,
            ['signal:SIGTERM', 'signal:SIGKILL', 'unwinding', 'gone', `probe:${port}`, `probe:${port}`],
            'the reap waits out the process, THEN polls the port until it reads free',
          );
          assert.ok(!lines.join('\n').includes('still closing'), 'a port that came back free on the second ask is not reported as held');
        } finally {
          jetpack.remove(projectDir);
        }
      },
    },
  ],
});
