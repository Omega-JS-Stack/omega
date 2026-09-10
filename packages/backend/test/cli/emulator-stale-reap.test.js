/**
 * Test: a previous boot's leftovers are reaped from the record that named them
 * ([#721](https://github.com/Omega-JS-Stack/omega/issues/721)).
 *
 * The pre-boot reaper is PORT-driven: it only ever considers pids listening on
 * the ports this run wants. The reload watcher binds nothing at all, so it is
 * unreachable by construction — and the record that names it is overwritten by
 * the very next boot, so a run that died without teardown leaves a nodemon
 * nothing will ever name again. The record is therefore read, and reaped from,
 * BEFORE it is overwritten.
 *
 * Run: npx omega test backend:cli/emulator-stale-reap
 *
 * A recorded pid is a NUMBER, and the OS hands numbers out again. This suite is
 * about the gate that stands between that number and a signal, so every process
 * here is a fixture: the seam that reads a `ps` row, the seam that signals, and
 * the seam that probes a port are all injected, nothing is spawned, and nothing
 * real is ever signalled. The rows are real ones from a booted sandbox emulator.
 */
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { EventEmitter } = require('events');
const jetpack = require('fs-jetpack');

const EmulatorCommand = require('../../dist/cli/commands/emulator.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const OURS = 'demo-sandbox-brand';

// Real rows from `ps -o command=` against a booted sandbox emulator.
const FIREBASE_PARENT = 'node /Users/ian/.nvm/versions/node/v22.22.1/bin/firebase emulators:start --only functions,firestore,auth,database,hosting,pubsub';
const FIRESTORE_JAR = 'java -jar cloud-firestore-emulator-v1.21.0.jar --host 127.0.0.1 --port 8080 --project_id demo-sandbox-brand';
const PUBSUB_JAR = 'java -jar cloud-pubsub-emulator-0.8.34-all.jar --host=127.0.0.1 --port=8085';
const NEIGHBOUR_JAR = FIRESTORE_JAR.replace(OURS, 'demo-other-brand');
// The whole reason this reap exists: a nodemon that binds no port, so no port
// sweep can ever reach it. It matches the machinery signature only because
// watch.js bakes the `emulator.log.reset` sentinel path into its --exec argv.
const NODEMON_WATCHER = 'node /Users/ian/.nvm/versions/node/v22.22.1/bin/nodemon --on-change-only --delay 1 --watch /omega/packages/backend/src --ext js,json --exec node -e "fs.writeFileSync(\'/omega/brands/sandbox-brand/targets/backend/.temp/emulator.log.reset\',\'\')"';
// What a recycled number looks like: the OS gave it to somebody else entirely.
const STRANGER = 'node /Users/ian/Developer/some-other-tool/server.js --serve';

// Where a dead run's survivors are parented. PID 1 is every orphan of it; a
// number handed to a LIVE stack hangs off THAT stack's firebase instead, and
// this record has never heard of it.
const ORPHANED = 1;
const ANOTHER_STACKS_FIREBASE = 7777;

// Comfortably past PID_RECORD_MAX_AGE_MS (12h) — a record whose numbers are no
// longer known to name the processes they named.
const EXPIRED_AT = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

/**
 * An emulator command pointed at a throwaway project, with a PREVIOUS boot's
 * record already on disk — the state this boot finds before it writes its own.
 * @param {object} record - The record fields to write.
 */
function commandWithRecord({ pids, rootPid, ports = {}, projectId = OURS, startedAt = new Date().toISOString() }) {
  const projectDir = path.join(os.tmpdir(), `omega-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const command = new EmulatorCommand({ firebaseProjectPath: projectDir, argv: {}, options: {} });
  const lines = [];

  command.log = (message) => lines.push(String(message));
  command.logWarning = (message) => lines.push(String(message));

  jetpack.write(command.getTempPath('emulator-pids.json'), {
    pids: pids,
    projectId: projectId,
    rootPid: rootPid,
    ports: ports,
    startedAt: startedAt,
  });

  return { command, lines, cleanup: () => jetpack.remove(projectDir) };
}

/**
 * A fixture process table plus the three seams the reap reads the world through.
 *
 * `readProcess` is the `ps -o ppid=,command=` seam, `kill` is the signal seam,
 * and `isFree` is the port probe the settle wait polls — so a case states what
 * is running, and reads back exactly what would have been signalled and which
 * ports were waited on. Nothing leaves this process.
 * @param {object} table - pid → { ppid, command } as ps would report it.
 * @param {Function} [afterTerm] - What SIGTERM does to the table (defaults to
 *   the process exiting).
 */
function processTable(table, afterTerm) {
  const live = new Map(Object.entries(table).map(([pid, row]) => [Number(pid), row]));
  const signals = [];
  const probed = [];

  return {
    signals: signals,
    probed: probed,
    signalled: (pid) => signals.filter((entry) => entry.pid === Number(pid)).map((entry) => entry.signal),
    seams: {
      readProcess: (pid) => live.get(Number(pid)) || null,
      kill: (pid, signal) => {
        signals.push({ pid: Number(pid), signal: signal });

        if (signal === 'SIGTERM') {
          (afterTerm || ((target) => live.delete(target)))(Number(pid), live);
        } else {
          live.delete(Number(pid));
        }
      },
      isFree: async (port) => {
        probed.push(port);
        return true;
      },
    },
  };
}

/**
 * A throwaway backend target root whose emulator ports are nowhere near the
 * classic map — the boot path resolves its ports from this file.
 */
function makeProject() {
  const projectDir = path.join(os.tmpdir(), `omega-stale-boot-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const base = 49000 + Math.floor(Math.random() * 8000);
  const names = ['auth', 'functions', 'firestore', 'database', 'hosting', 'storage', 'pubsub', 'ui'];

  jetpack.write(path.join(projectDir, 'firebase.json'), JSON.stringify({
    emulators: Object.fromEntries(names.map((name, index) => [name, { port: base + index }])),
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
 * Run `fn` with the given fixture standing in for `child_process.spawn`.
 *
 * The boot reaches spawn through `cli/utils/spawn-shell.js`, which reads
 * `childProcess.spawn` at CALL time
 * ([#769](https://github.com/Omega-JS-Stack/omega/issues/769)) — so the stand-in
 * is installed for the DURATION of the boot (a load-time swap would be gone by
 * the time the boot ran, and the boot would spawn a real emulator), and it is
 * taken straight back out.
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

module.exports = defineCases({
  description: 'emulator pre-boot reap of a stale pid record',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'a-dead-runs-orphaned-watcher-is-reaped-from-its-record',
      async run({ assert }) {
        // The defect: the watcher binds nothing, so the port reaper cannot see
        // it, and this boot is about to overwrite the only file that names it.
        const { command, cleanup } = commandWithRecord({ pids: [4001, 4002], rootPid: 4001 });
        const table = processTable({ 4002: { ppid: ORPHANED, command: NODEMON_WATCHER } });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signalled(4002), ['SIGTERM'], 'the orphaned watcher is stopped by the record that named it');
          assert.deepEqual(table.signalled(4001), [], 'the root is already gone — nothing to signal');
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'a-recycled-pid-running-something-else-is-never-signalled',
      async run({ assert }) {
        // The number came back, attached to a stranger. The record says it is
        // ours; the LIVE command line is the only thing that can disagree, and
        // it does.
        const { command, lines, cleanup } = commandWithRecord({ pids: [4001, 4002], rootPid: 4001 });
        const table = processTable({ 4002: { ppid: ORPHANED, command: STRANGER } });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signals, [], 'a recorded number now running a stranger is left alone');
          assert.match(lines.join('\n'), /Left 1 recorded/);
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'a-recycled-pid-on-another-brands-jar-is-left-alone',
      async run({ assert }) {
        // The harder recycling: the number came back as emulator machinery, so
        // "is this a jar" passes. The jar names ITS project on its own command
        // line, and it is not ours.
        const { command, cleanup } = commandWithRecord({ pids: [4001, 4002], rootPid: 4001 });
        const table = processTable({ 4002: { ppid: ORPHANED, command: NEIGHBOUR_JAR } });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signals, [], "another brand's live jar must survive our recorded number");
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'a-pid-whose-command-cannot-be-read-is-never-signalled',
      async run({ assert }) {
        // No command line is no evidence — the process is gone, or the read
        // failed. Either way there is no proof of identity, so there is no
        // kill order.
        const { command, cleanup } = commandWithRecord({ pids: [4001, 4002], rootPid: 4001 });
        const table = processTable({});

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signals, [], 'a pid with no readable command is never signalled');
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'the-run-never-signals-itself',
      async run({ assert }) {
        // `omega emulator` matches the machinery signature by NAME, so a
        // recorded number recycled onto this very process would read as a
        // reapable leftover and the boot would SIGTERM itself.
        const { command, cleanup } = commandWithRecord({ pids: [4001, process.pid], rootPid: 4001 });
        const table = processTable({ [process.pid]: { ppid: process.ppid, command: 'node /omega/node_modules/.bin/omega emulator' } });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signals, [], 'this process is never a reap target');
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'a-live-root-means-the-record-is-not-stale',
      async run({ assert }) {
        // The record belongs to a run that is still UP. Its jars are that run's
        // business, and this boot is a second stack beside it — reaping here
        // would kill a live sibling emulator mid-session.
        const { command, cleanup } = commandWithRecord({ pids: [4001, 4002, 4003], rootPid: 4001 });
        const table = processTable({
          4001: { ppid: 3999, command: FIREBASE_PARENT },
          4002: { ppid: 4001, command: FIRESTORE_JAR },
          4003: { ppid: 4001, command: PUBSUB_JAR },
        });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signals, [], 'a record whose root is alive is a LIVE record, not a leftover');
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'a-record-with-no-root-pid-is-not-a-kill-order',
      async run({ assert }) {
        // Staleness is proved by the ROOT, and a record that never named one
        // proves nothing. Read as "no root answering", a rootPid-less record
        // over a LIVE stack of this very project reads as pure leftovers — and
        // the reap takes the running firebase parent and its jars with it.
        const { command, cleanup } = commandWithRecord({ pids: [4001, 4002, 4003], rootPid: undefined });
        const table = processTable({
          4001: { ppid: 3999, command: FIREBASE_PARENT },
          4002: { ppid: 4001, command: FIRESTORE_JAR },
          4003: { ppid: 4001, command: PUBSUB_JAR },
        });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signals, [], 'a record with no root pid supports no kill order');
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'an-expired-record-names-nobody',
      async run({ assert }) {
        // Past the record's age bound the numbers are no longer known to name
        // the processes they named, so the record supports no pid at all — the
        // same rule every other path reads it by.
        const { command, cleanup } = commandWithRecord({ pids: [4001, 4002], rootPid: 4001, startedAt: EXPIRED_AT });
        const table = processTable({ 4002: { ppid: ORPHANED, command: FIRESTORE_JAR } });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signals, [], 'an expired record is not a kill order');
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'sigkill-escalates-only-while-the-identity-still-holds',
      async run({ assert }) {
        // The grace window is long enough for a pid to be freed and handed out
        // again, and there is no apologising to a SIGKILL. 4002 takes the
        // SIGTERM and the number comes back as a stranger; 4003 is still the
        // jar it was, and gets the escalation.
        const { command, lines, cleanup } = commandWithRecord({ pids: [4001, 4002, 4003], rootPid: 4001 });
        const table = processTable(
          { 4002: { ppid: ORPHANED, command: PUBSUB_JAR }, 4003: { ppid: ORPHANED, command: FIRESTORE_JAR } },
          (pid, live) => live.set(pid, pid === 4002 ? { ppid: ORPHANED, command: STRANGER } : live.get(pid)),
        );

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signalled(4002), ['SIGTERM'], 'a number recycled inside the grace window is not SIGKILLed');
          assert.deepEqual(table.signalled(4003), ['SIGTERM', 'SIGKILL'], 'a survivor that is still ours is taken');
          // The count is what went DOWN, not what was ordered down: 4002 is
          // spared here, so reporting it reaped would contradict the very next
          // line of output.
          assert.match(lines.join('\n'), /Reaped 1 recorded process left by a previous run \(1 needed SIGKILL\)/);
          assert.match(lines.join('\n'), /Left 1 recorded pid alone/);
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'a-recycled-pid-on-a-live-stacks-no-project-jar-is-left-alone',
      async run({ assert }) {
        // The residual the project-id proof cannot reach: the pubsub emulator
        // names no project at all, so a recycled number running the NEIGHBOUR
        // brand's LIVE pubsub jar reads as our own leftover on record
        // membership alone. Its PARENT is the thing that disagrees — that jar
        // hangs off a firebase this record has never heard of, while every
        // survivor of the dead run is an orphan
        // ([#730](https://github.com/Omega-JS-Stack/omega/issues/730)).
        const { command, lines, cleanup } = commandWithRecord({ pids: [4001, 4002], rootPid: 4001 });
        const table = processTable({ 4002: { ppid: ANOTHER_STACKS_FIREBASE, command: PUBSUB_JAR } });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signals, [], "another brand's live jar must survive our recorded number, project id or not");
          assert.match(lines.join('\n'), /Left 1 recorded pid alone/);
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'a-jar-still-hanging-off-the-dead-run-is-reaped',
      async run({ assert }) {
        // The other half of the parent proof, so it cannot narrow to "orphans
        // only": the `sh` root is gone but the firebase it spawned outlived it,
        // and the jars still hang off THAT — a pid this very record names. The
        // whole tree is the dead run's, and all of it is reapable.
        const { command, cleanup } = commandWithRecord({ pids: [4001, 4002, 4003], rootPid: 4001 });
        const table = processTable({
          4002: { ppid: ORPHANED, command: FIREBASE_PARENT },
          4003: { ppid: 4002, command: FIRESTORE_JAR },
        });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signalled(4002), ['SIGTERM'], "the dead run's own firebase parent is reaped");
          assert.deepEqual(table.signalled(4003), ['SIGTERM'], 'and so is the jar still parented to it');
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'a-reap-waits-for-the-recorded-ports-to-come-back',
      async run({ assert }) {
        // A SIGKILLed JVM holds its listener for a moment after kill() returns
        // and the allocator probes these very ports a few lines later — the
        // same race the port-driven reaper answers. A reap here is BY PID, so
        // the record's own map is the set to wait on. `https` is not part of
        // it: that port belonged to the dead run's in-process TLS proxy, never
        // to a jar this reap could take.
        const { command, cleanup } = commandWithRecord({
          pids: [4001, 4002],
          rootPid: 4001,
          ports: { firestore: 8080, hosting: 5443, https: 5002 },
        });
        const table = processTable({ 4002: { ppid: ORPHANED, command: FIRESTORE_JAR } });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.signalled(4002), ['SIGTERM'], 'the recorded jar goes down');
          assert.deepEqual([...new Set(table.probed)].sort(), [5443, 8080], "the reaped record's ports are waited on, https excluded");
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'a-reap-that-took-nothing-waits-for-nothing',
      async run({ assert }) {
        // The wait is the price of a kill, not of a boot: a record that proved
        // nothing reapable freed no port, so the allocator is not held up.
        const { command, cleanup } = commandWithRecord({
          pids: [4001, 4002],
          rootPid: 4001,
          ports: { firestore: 8080 },
        });
        const table = processTable({ 4002: { ppid: ORPHANED, command: STRANGER } });

        try {
          await command.reapStaleRecordedProcesses(command.readEmulatorOwnership(), table.seams);

          assert.deepEqual(table.probed, [], 'nothing was reaped, so no port is waited on');
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'the-boot-path-reaps-the-stale-record-before-it-overwrites-it',
      async run({ assert }) {
        // Nothing else in this suite executes the CALL, so deleting the line in
        // startEmulators left every case green. This one drives the real boot
        // path: the reap runs, it is handed the PREVIOUS record (the file this
        // boot is about to replace), and the replacement happens after
        // ([#730](https://github.com/Omega-JS-Stack/omega/issues/730)).
        const { projectDir, cleanup } = makeProject();
        const table = processTable({ 4002: { ppid: ORPHANED, command: NODEMON_WATCHER } });
        const order = [];
        const spawned = [];
        const portEnv = Object.keys(process.env).filter((key) => /^OMEGA_.*_PORT$/.test(key));
        const priorEnv = Object.fromEntries(portEnv.map((key) => [key, process.env[key]]));
        let child = null;

        // The one thing this boot may never do is spawn a real emulator: the
        // fixture stands in for `spawn` itself, for as long as the boot runs.
        const fixtureSpawn = (file, args) => {
          spawned.push({ file, args });
          child = fixtureChild();
          // Emitted once the boot has attached its readiness handlers.
          setImmediate(() => child.stdout.emit('data', Buffer.from('[fixture] All emulators ready\n')));
          return child;
        };

        const command = new EmulatorCommand({ firebaseProjectPath: projectDir, argv: { https: false, seed: false }, options: {} });
        const reap = EmulatorCommand.prototype.reapStaleRecordedProcesses;

        command.log = () => {};
        command.logWarning = () => {};
        command.ensureStaged = () => {};
        command.startStageWatch = () => ({ close: () => {} });
        // The machine-wide sweep and the port preflight both signal REAL pids
        // on REAL ports — never run them from a test. This case is about the
        // record-driven reap beside them.
        command.reapMachineOrphans = async () => {};
        command.preflightEmulatorPorts = async () => [];
        command.reapStaleRecordedProcesses = function (ownership) {
          order.push('reap');
          return reap.call(this, ownership, table.seams);
        };
        command.writeEmulatorPidRecord = () => { order.push('record'); return []; };

        jetpack.write(path.join(projectDir, '.temp', 'emulator-pids.json'), {
          pids: [4001, 4002],
          projectId: OURS,
          rootPid: 4001,
          ports: {},
          startedAt: new Date().toISOString(),
        });

        try {
          await withSpawn(fixtureSpawn, () => command.startEmulators({ https: false }));

          assert.equal(spawned.length, 1, 'the boot spawned exactly one child — the fixture, never a real emulator');
          assert.deepEqual(order, ['reap', 'record'], 'the stale record is reaped BEFORE this boot overwrites it');
          assert.deepEqual(table.signalled(4002), ['SIGTERM'], "the previous run's watcher is stopped by the boot path itself");
        } finally {
          // The child's close handler owns the log sink's timer.
          if (child) child.emit('close', 0, null);
          for (const key of Object.keys(process.env)) {
            if (/^OMEGA_.*_PORT$/.test(key) && !(key in priorEnv)) delete process.env[key];
          }
          Object.assign(process.env, priorEnv);
          cleanup();
        }
      },
    },

    // The read primitive itself (#730 review): `ps` exiting 1 is the one
    // provable "gone". Any OTHER failure proves nothing — and it must come back
    // TRUTHY, because the root gate turns a falsy root read into a kill order
    // over the whole record. The sentinel also matches no identity proof, so a
    // member read spares the pid instead of signalling on a guess.
    {
      name: 'an-unreadable-ps-reads-as-alive-never-as-gone',
      async run({ assert }) {
        const realExecSync = childProcess.execSync;

        try {
          childProcess.execSync = () => {
            const gone = new Error('ps: no such process');
            gone.status = 1;
            throw gone;
          };
          assert.equal(
            EmulatorCommand.readProcessInfo(4001),
            null,
            'ps exiting 1 is the provable answer: the pid is gone',
          );

          childProcess.execSync = () => {
            throw new Error('spawn ps EAGAIN');
          };
          const unreadable = EmulatorCommand.readProcessInfo(4001);

          assert.ok(unreadable, 'an exec failure is NOT proof of death — the root gate must read it as alive');
          assert.ok(
            !EmulatorCommand.isReapableRecordedProcess(
              { pid: 4001, ppid: unreadable.ppid, command: unreadable.command },
              { pids: [4001, 4002], rootPid: 4001, projectId: OURS },
            ),
            'the sentinel proves no identity, so a member read spares the pid',
          );
        } finally {
          childProcess.execSync = realExecSync;
        }
      },
    },
  ],
});
