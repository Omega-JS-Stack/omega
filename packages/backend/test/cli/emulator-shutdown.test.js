/**
 * Test: a stack stop takes the whole family with it
 * ([#304](https://github.com/Omega-JS-Stack/omega/issues/304)).
 *
 * firebase-tools starts each java emulator in its OWN process group, so the
 * group signal shutdown() sends reaches `sh`/firebase and nothing else. When
 * the graceful stop does not finish inside the grace window the escalation
 * SIGKILLs the parent, the jars reparent to PID 1, and they hold the classic
 * ports until somebody hand-kills them — four parentless firestore jars after
 * one afternoon of normal restarts. The pid record written while the tree was
 * still attached is the only surviving link, so the stop path signals it BY PID.
 *
 * Run: npx omega test backend:cli/emulator-shutdown
 *
 * The processes below are REAL and detached (their own process group, exactly
 * like the jars) — nothing here is a stand-in for a process. Only their command
 * lines are fixtures, copied from `ps -o command=` against a booted sandbox
 * emulator, because a real firestore jar takes seconds to boot and proves
 * nothing extra about the signal.
 *
 * The last two cases run the COMMAND, not one of its methods: the stop path can
 * be correct and still never be reached, which is how the reaper call and the
 * exit path's join could both be deleted with every other case here green. They
 * boot against a `firebase` on PATH that only decides the two things the boot
 * path reads — whether the ready marker arrives, and when the child exits — so
 * the spawn, the process group, the pid record and the ports stay real.
 */
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');

const EmulatorCommand = require('../../src/cli/commands/emulator.js');
const WatchCommand = require('../../src/cli/commands/watch.js');

const { isStoppableEmulatorProcess } = EmulatorCommand;

const OURS = 'demo-sandbox-brand';

// What the recorded pids actually are, from a booted sandbox emulator.
const FIRESTORE_JAR = 'java -jar cloud-firestore-emulator-v1.21.0.jar --host 127.0.0.1 --port 8080 --project_id demo-sandbox-brand';
const PUBSUB_JAR = 'java -jar cloud-pubsub-emulator-0.8.34-all.jar --host=127.0.0.1 --port=8085';
const NEIGHBOUR_JAR = FIRESTORE_JAR.replace(OURS, 'demo-other-brand');

// Stand-ins for `firebase emulators:start`, on PATH as `firebase`. A real
// firebase boot needs a real project and half a minute; what the boot path owes
// its caller is decided by two things only — whether the ready marker ever
// arrives, and when the child exits.
const FIREBASE_READY_THEN_EXITS = '#!/bin/sh\necho "All emulators ready!"\nsleep 0.5\n';
const FIREBASE_DIES_BEFORE_READY = '#!/bin/sh\necho "Error: could not start emulators" >&2\nexit 1\n';

/**
 * A real, detached, long-lived process whose command line reads like `marker`.
 * Detached is the point: it sits in its own process group, so the group signal
 * the stop path sends its firebase child can never reach it.
 */
function spawnDetached(marker) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', ...marker.split(' ')], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  return child.pid;
}

/**
 * A port nothing is listening on. The suites run against a LIVE emulator, so
 * the classic numbers are held by the stack running this very test — the stop
 * path's port check would read that as a leak.
 */
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));

  return port;
}

/**
 * Did this child process exit inside the window? A signalled child is a ZOMBIE
 * until its parent reaps it, and a zombie still answers `kill(pid, 0)` — the
 * exit event is the honest read.
 */
function exitedWithin(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function stopAll(pids) {
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL'); } catch (e) { /* already gone */ }
  }
}

/**
 * An emulator command pointed at a throwaway project dir, with a pid record
 * already written — the state a stop path finds after boot recorded the stack.
 */
function commandWithRecord(pids) {
  const projectDir = path.join(os.tmpdir(), `omega-shutdown-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const command = new EmulatorCommand({ firebaseProjectPath: projectDir, argv: {}, options: {} });
  const lines = [];

  command.log = (message) => lines.push(String(message));
  command.logWarning = (message) => lines.push(String(message));

  jetpack.write(command.getTempPath('emulator-pids.json'), {
    pids: pids,
    projectId: OURS,
    rootPid: pids[0],
    startedAt: new Date().toISOString(),
  });

  return { command, lines, cleanup: () => jetpack.remove(projectDir) };
}

/**
 * An emulator command that can actually BOOT: a throwaway project whose
 * firebase.json names ports nothing else uses, and a `firebase` on PATH that
 * behaves like `script` says.
 *
 * Three seams are neutralized because they reach outside the throwaway project
 * rather than into it: attachVerbLog re-tees THIS process' stdout (the runner's
 * own output), and ensureStaged/startStageWatch build and watch a src/ tree
 * that does not exist here. Everything the stop path touches — the spawn, the
 * process group, the pid record, the ports — is real.
 */
async function bootableCommand(script) {
  const projectDir = path.join(os.tmpdir(), `omega-boot-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // execute() runs IN-PROCESS and the boot path publishes its resolved map
  // into process.env (portsToEnv + emulator hosts). This runner is SHARED with
  // every later suite — a leaked OMEGA_HOSTING_PORT pointed the payment
  // journeys' in-process webhook at the throwaway project's dead port. Snapshot
  // the whole env and restore it in cleanup.
  const savedEnv = { ...process.env };
  const savedPath = process.env.PATH;

  // Ports the kernel just handed out: free, so the allocator resolves them
  // verbatim, and nowhere near the classic map the live emulator running this
  // very suite is sitting on.
  const names = ['auth', 'functions', 'firestore', 'database', 'hosting', 'storage', 'pubsub', 'ui'];
  const emulators = {};
  const taken = new Set();
  for (const name of names) {
    let port = await freePort();
    while (taken.has(port)) port = await freePort();
    taken.add(port);
    emulators[name] = { port: port };
  }

  jetpack.write(path.join(projectDir, 'firebase.json'), JSON.stringify({ emulators }, null, 2));
  jetpack.dir(path.join(projectDir, 'dist'));
  jetpack.file(path.join(projectDir, 'bin', 'firebase'), { content: script, mode: '755' });
  process.env.PATH = `${path.join(projectDir, 'bin')}${path.delimiter}${savedPath}`;

  const command = new EmulatorCommand({
    firebaseProjectPath: projectDir,
    argv: { https: false, seed: false },
    options: {},
  });
  const lines = [];

  command.log = (message) => lines.push(String(message));
  command.logWarning = (message) => lines.push(String(message));
  command.logError = (message) => lines.push(String(message));
  command.attachVerbLog = () => '';
  command.ensureStaged = () => {};
  command.startStageWatch = () => ({ close: () => {} });

  return {
    command,
    lines,
    ports: emulators,
    cleanup: () => {
      for (const key of Object.keys(process.env)) {
        if (!(key in savedEnv)) delete process.env[key];
      }
      Object.assign(process.env, savedEnv);
      jetpack.remove(projectDir);
    },
  };
}

/**
 * Run `fn` with the background watcher swapped for a REAL detached process.
 *
 * The watcher itself is a nodemon over the framework's own src/ — pointing one
 * at this repo mid-test would start a second live reload lane, and on a
 * registry install it does not start at all. What the run owes it is a signal,
 * and a real process proves the signal for real.
 */
async function withRealWatcherStandIn(fn) {
  const original = WatchCommand.prototype.startBackground;
  const watchers = [];

  WatchCommand.prototype.startBackground = function () {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    watchers.push(child);

    return child;
  };

  try {
    return await fn(watchers);
  } finally {
    WatchCommand.prototype.startBackground = original;
    stopAll(watchers.map((child) => child.pid));
  }
}

// The stop path also sweeps the ports it was handed, and on a defaults run the
// SHARED hub/storage numbers with them. A unit test's map is synthetic, so the
// shared pair is never this record's business — every direct call below says so.
const NO_SHARED_SWEEP = { sweepShared: false };

module.exports = {
  description: 'emulator stop path: the recorded stack goes down with it',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'the-stop-path-terminates-the-jars-the-group-signal-missed',
      async run({ assert }) {
        const firestore = spawnDetached(FIRESTORE_JAR);
        const pubsub = spawnDetached(PUBSUB_JAR);
        const { command, cleanup } = commandWithRecord([firestore, pubsub]);

        try {
          await command.terminateRecordedEmulatorProcesses({ firestore: await freePort() }, NO_SHARED_SWEEP);

          assert.equal(isAlive(firestore), false, 'the recorded firestore jar should be stopped');
          assert.equal(isAlive(pubsub), false, 'the recorded pubsub jar should be stopped');
        } finally {
          stopAll([firestore, pubsub]);
          cleanup();
        }
      },
    },

    {
      name: 'a-recycled-pid-is-never-a-kill-order',
      async run({ assert }) {
        // The record names pids, and the OS hands those numbers out again. A
        // recorded number now running something that is not emulator machinery
        // is a stranger, and the stop path has no port to narrow by.
        const stranger = spawnDetached('some-other-tool --serve');
        const { command, cleanup } = commandWithRecord([stranger]);

        try {
          await command.terminateRecordedEmulatorProcesses({ firestore: await freePort() }, NO_SHARED_SWEEP);

          assert.equal(isAlive(stranger), true, 'a recycled pid running something else must be left alone');
        } finally {
          stopAll([stranger]);
          cleanup();
        }
      },
    },

    {
      name: 'a-recycled-pid-running-another-brands-jar-is-left-alone',
      async run({ assert }) {
        // The harder recycling: the number came back as emulator machinery, so
        // "is this a jar" passes and the record's pid membership used to end
        // the question there. The jar names ITS project on its own command
        // line, and it is not ours.
        const neighbour = spawnDetached(NEIGHBOUR_JAR);
        const { command, cleanup } = commandWithRecord([neighbour]);

        try {
          await command.terminateRecordedEmulatorProcesses({ firestore: await freePort() }, NO_SHARED_SWEEP);

          assert.equal(isAlive(neighbour), true, "another brand's live jar must survive our recorded pid");
        } finally {
          stopAll([neighbour]);
          cleanup();
        }
      },
    },

    {
      name: 'a-port-still-held-by-somebody-else-is-reported-not-killed',
      async run({ assert }) {
        // The port check is evidence for the human, never a kill order:
        // signaling whatever answers on a port is what took down another
        // project's live stack ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)).
        const server = net.createServer();
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        const { command, lines, cleanup } = commandWithRecord([]);

        try {
          await command.terminateRecordedEmulatorProcesses({ hosting: port }, NO_SHARED_SWEEP);

          assert.equal(server.listening, true, 'the foreign listener keeps its port');
          assert.match(lines.join('\n'), new RegExp(`still in use after shutdown: ${port}`));
        } finally {
          server.close();
          cleanup();
        }
      },
    },

    {
      name: 'the-orphan-sweep-runs-before-the-port-verdict',
      async run({ assert }) {
        // A jar the record never named (spawned after the last snapshot, then
        // reparented to PID 1) is the SWEEP's case, not the record's. Polling
        // the ports first spent the whole release window waiting on a port the
        // next step was about to free, then called it somebody else's.
        const server = net.createServer();
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        const { command, lines, cleanup } = commandWithRecord([]);
        let swept = false;

        // The sweep's own kill decision is proven above and in the #274/#293
        // suites; what is under test here is WHEN it runs, so it stands in as
        // the thing it would do to a squatter it owns.
        command.terminateOrphanedEmulatorProcesses = () => {
          swept = true;
          server.close();
        };

        const startedAt = Date.now();

        try {
          await command.terminateRecordedEmulatorProcesses({ hosting: port }, NO_SHARED_SWEEP);

          assert.equal(swept, true, 'the stop path runs the owned-orphan sweep itself');
          assert.equal(lines.join('\n').includes('still in use'), false, `a port the sweep freed is not somebody else's: ${lines.join(' | ')}`);
          assert.equal(Date.now() - startedAt < 2000, true, 'no full release-window stall for a port the sweep already freed');
        } finally {
          server.close();
          cleanup();
        }
      },
    },

    {
      name: 'the-run-that-shut-down-cleanly-reports-nothing',
      async run({ assert }) {
        // Everything already gone (the group signal did reach them) and every
        // port free: the stop path is silent, no phantom warnings.
        const gone = spawnDetached(FIRESTORE_JAR);
        stopAll([gone]);
        await powertools.wait(200);

        const { command, lines, cleanup } = commandWithRecord([gone]);

        try {
          await command.terminateRecordedEmulatorProcesses({ firestore: await freePort() }, NO_SHARED_SWEEP);

          assert.equal(lines.length, 0, `a clean stop should say nothing, said: ${lines.join(' | ')}`);
        } finally {
          cleanup();
        }
      },
    },

    // ─── the ownership bar the stop path clears ───

    {
      name: 'a-recorded-pid-still-running-emulator-machinery-is-stoppable',
      async run({ assert }) {
        assert.equal(isStoppableEmulatorProcess({ pid: 37088, command: FIRESTORE_JAR }, { pids: [37088], projectId: OURS }), true);
        assert.equal(isStoppableEmulatorProcess({ pid: 37088, command: 'node /Users/ian/some-other-tool/server.js' }, { pids: [37088], projectId: OURS }), false);
        assert.equal(isStoppableEmulatorProcess({ pid: 51001, command: NEIGHBOUR_JAR }, { pids: [], projectId: OURS }), false);
      },
    },

    {
      name: 'a-command-line-that-names-another-project-outranks-the-record',
      async run({ assert }) {
        // Pid membership short-circuited the project check, so a recorded
        // number recycled onto the neighbouring brand's jar read as ours.
        assert.equal(isStoppableEmulatorProcess({ pid: 37088, command: NEIGHBOUR_JAR }, { pids: [37088], projectId: OURS }), false);

        // A jar that names NO project (pubsub never does) is still decided by
        // the record — that is the whole reason the record exists.
        assert.equal(isStoppableEmulatorProcess({ pid: 37088, command: PUBSUB_JAR }, { pids: [37088], projectId: OURS }), true);

        // And with no project id of our own there is nothing to disagree with.
        assert.equal(isStoppableEmulatorProcess({ pid: 37088, command: NEIGHBOUR_JAR }, { pids: [37088], projectId: null }), true);
      },
    },

    // ─── the wiring: the run's exit path joins the stop path ───

    {
      name: 'the-exit-path-joins-the-shutdown-and-its-reaper',
      timeout: 60000,
      async run({ assert }) {
        // Deleting the reaper call from shutdown(), or the `await shutdown()`
        // the exit path joins it with, left every other test in this file
        // green: they call the reaper directly. This one boots the real command
        // and watches the RUN carry it.
        await withRealWatcherStandIn(async (watchers) => {
          const { command, ports, cleanup } = await bootableCommand(FIREBASE_READY_THEN_EXITS);
          const reaped = [];

          // Resolves a beat late on purpose: a shutdown that fires and forgets
          // returns before this records anything.
          command.terminateRecordedEmulatorProcesses = async (emulatorPorts, options) => {
            await powertools.wait(200);
            reaped.push({ emulatorPorts, options });
          };

          try {
            await command.execute();

            assert.equal(reaped.length, 1, 'the run must join the shutdown it started, reaper included');
            assert.equal(reaped[0].emulatorPorts.hosting, ports.hosting.port, 'the reaper gets this run\'s RESOLVED port map');
            assert.equal(reaped[0].options.sweepShared, true, 'nothing bumped, so the shared hub/storage ports are this run\'s to sweep');
            assert.equal(await exitedWithin(watchers[0], 3000), true, 'the background watcher goes down with the run');
          } finally {
            cleanup();
          }
        });
      },
    },

    {
      name: 'a-boot-that-never-came-up-still-tears-down-what-it-started',
      timeout: 60000,
      async run({ assert }) {
        // The boot-failure catch exited straight out: the watcher it had just
        // started stayed alive (a nodemon nothing else signals) and whatever
        // the spawn got as far as was never stopped.
        await withRealWatcherStandIn(async (watchers) => {
          const { command, cleanup } = await bootableCommand(FIREBASE_DIES_BEFORE_READY);
          const reaped = [];
          command.terminateRecordedEmulatorProcesses = async () => { reaped.push(true); };

          // The one stub the framework's rules name outright: a real exit here
          // takes the test runner with it mid-assertion.
          const realExit = process.exit;
          const exits = [];
          process.exit = (code) => { exits.push(code); };

          try {
            await command.execute();

            assert.deepEqual(exits, [1], 'a failed boot still exits non-zero');
            assert.equal(reaped.length, 1, 'a failed boot runs the same stop path a normal one does');
            assert.equal(await exitedWithin(watchers[0], 3000), true, 'the watcher does not outlive the failed boot');
          } finally {
            process.exit = realExit;
            cleanup();
          }
        });
      },
    },
  ],
};
