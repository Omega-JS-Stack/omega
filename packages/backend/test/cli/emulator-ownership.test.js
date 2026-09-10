/**
 * Test: the orphan sweep only signals processes it can prove are ours
 * ([#274](https://github.com/Omega-JS-Stack/omega/issues/274)).
 *
 * The post-shutdown sweep scanned its resolved port set plus the SHARED hub and
 * storage ports and signaled whatever was listening. Port occupancy is not
 * ownership: it terminated a live `mgr emulator` belonging to another project
 * and another session. Ownership now needs proof — a pid this run recorded when
 * it spawned the stack, or a command line that names an emulator AND this
 * project id. Everything else is left alone, on every port.
 *
 * Run: npx omega test backend:cli/emulator-ownership
 *
 * The matcher is pure (a ps row in, a verdict out). The command lines below are
 * REAL, copied from `ps -A -o pid=,ppid=,command=` against a booted sandbox
 * emulator — the fixture is what the sweep actually reads, not an invention.
 */
const EmulatorCommand = require('../../dist/cli/commands/emulator.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const { isOwnedEmulatorProcess, ownershipFromRecord } = EmulatorCommand;

const OURS = 'demo-sandbox-brand';

// Real rows from a booted sandbox emulator (paths shortened only where they
// carry no signal). The firestore jar is the ONE child whose command names the
// project; the firebase parent and the other emulators name nothing.
const FIREBASE_PARENT = 'node /Users/ian/.nvm/versions/node/v22.22.1/bin/firebase emulators:start --only functions,firestore,auth,database,hosting,pubsub --config firebase.resolved.json';
const FIRESTORE_JAR = 'java -Dgoogle.cloud_firestore.debug_log_level=FINE -Duser.language=en -jar /Users/ian/.cache/firebase/emulators/cloud-firestore-emulator-v1.21.0.jar --host 127.0.0.1 --port 8080 --websocket_port 9150 --database-edition standard --project_id demo-sandbox-brand --rules /Users/ian/Developer/Repositories/Omega/omega/brands/sandbox-brand/targets/backend/firestore.rules --single_project_mode true';
const PUBSUB_JAR = 'java -jar /Users/ian/.cache/firebase/emulators/pubsub-emulator-0.8.34/pubsub-emulator/lib/cloud-pubsub-emulator-0.8.34-all.jar --host=127.0.0.1 --port=8085';

// The processes the sweep must never touch.
const FOREIGN_EMULATOR_CLI = 'node /Users/ian/Developer/Repositories/Omega/omega/node_modules/.bin/omega emulator';
const FOREIGN_FIRESTORE_JAR = FIRESTORE_JAR.replace(OURS, 'demo-other-brand');
// The hot-reload watcher: its command line mentions both "firebase" paths and
// `emulator.log.reset`, so a name-only signature matches it — and it is
// reparented to PID 1, so an orphan-shaped check matches it too.
const RELOAD_WATCHER = 'node /Users/ian/.nvm/versions/node/v22.22.1/bin/nodemon --on-change-only --delay 1 --watch /Users/ian/Developer/Repositories/Omega/omega/packages/backend/src --ext js,json --exec node -e "fs.writeFileSync(\'/Users/ian/Developer/Repositories/Omega/omega/brands/sandbox-brand/targets/backend/.temp/emulator.log.reset\',\'\')"';

module.exports = defineCases({
  description: 'emulator orphan sweep ownership matcher',
  type: 'group',

  tests: [
    {
      name: 'a-recorded-pid-is-ours-whatever-it-looks-like',
      async run({ assert }) {
        // The pid record written at spawn is the primary proof: the java
        // emulators name no project, so nothing else can vouch for them.
        const ownership = { pids: [37088, 37360, 38921], projectId: OURS };

        assert.equal(isOwnedEmulatorProcess({ pid: 38921, command: PUBSUB_JAR }, ownership), true);
        assert.equal(isOwnedEmulatorProcess({ pid: 37360, command: 'java -jar firebase-database-emulator-v4.11.2.jar --host 127.0.0.1 --port 9000' }, ownership), true);
      },
    },

    {
      name: 'an-emulator-command-naming-this-project-is-ours',
      async run({ assert }) {
        // The second proof route, for a child this run never recorded (a
        // leftover from a previous run of the SAME project).
        assert.equal(isOwnedEmulatorProcess({ pid: 37088, command: FIRESTORE_JAR }, { pids: [], projectId: OURS }), true);
      },
    },

    {
      name: 'another-projects-emulator-is-never-ours',
      async run({ assert }) {
        // The reported case, in both shapes: a sibling brand's stack.
        assert.equal(isOwnedEmulatorProcess({ pid: 51001, command: FOREIGN_FIRESTORE_JAR }, { pids: [], projectId: OURS }), false);
        assert.equal(isOwnedEmulatorProcess({ pid: 51002, command: FOREIGN_EMULATOR_CLI }, { pids: [], projectId: OURS }), false);
      },
    },

    {
      name: 'a-foreign-process-on-a-shared-port-is-never-ours',
      async run({ assert }) {
        // 4400 and 9199 are shared: whatever answers there is evidence of
        // nothing. The matcher is the only gate, and it sees no ports at all.
        assert.equal(isOwnedEmulatorProcess({ pid: 60001, command: RELOAD_WATCHER }, { pids: [], projectId: OURS }), false);
        assert.equal(isOwnedEmulatorProcess({ pid: 60002, command: 'node /Users/ian/some-other-tool/server.js' }, { pids: [], projectId: OURS }), false);
      },
    },

    {
      name: 'an-emulator-that-names-no-project-is-not-proven-ours',
      async run({ assert }) {
        // The firebase parent names no project — unrecorded, it is a stranger.
        // This is the row the old sweep signaled on port evidence alone.
        assert.equal(isOwnedEmulatorProcess({ pid: 34965, command: FIREBASE_PARENT }, { pids: [], projectId: OURS }), false);
        // ...and recorded, it is ours.
        assert.equal(isOwnedEmulatorProcess({ pid: 34965, command: FIREBASE_PARENT }, { pids: [34965], projectId: OURS }), true);
      },
    },

    {
      name: 'missing-evidence-never-reads-as-ownership',
      async run({ assert }) {
        assert.equal(isOwnedEmulatorProcess({ pid: 37088, command: FIRESTORE_JAR }, { pids: [], projectId: null }), false, 'no project id of our own proves nothing');
        assert.equal(isOwnedEmulatorProcess({ pid: 37088, command: FIRESTORE_JAR }, undefined), false, 'no evidence at all proves nothing');
        assert.equal(isOwnedEmulatorProcess({ pid: 1, command: FIRESTORE_JAR }, { pids: [1], projectId: OURS }), false, 'init is never a candidate');
        assert.equal(isOwnedEmulatorProcess({ pid: NaN, command: FIRESTORE_JAR }, { pids: [], projectId: OURS }), false);
      },
    },

    {
      name: 'a-project-id-that-only-appears-as-a-substring-does-not-count',
      async run({ assert }) {
        // `--project_id demo-sandbox-brand-staging` is a DIFFERENT project that
        // happens to start with ours; a path containing the brand name is not
        // a project id at all.
        const staging = FIRESTORE_JAR.replace(`--project_id ${OURS}`, `--project_id ${OURS}-staging`);

        assert.equal(isOwnedEmulatorProcess({ pid: 51003, command: staging }, { pids: [], projectId: OURS }), false);
        assert.equal(isOwnedEmulatorProcess({ pid: 51004, command: `java -jar cloud-firestore-emulator.jar --rules /repos/${OURS}/firestore.rules` }, { pids: [], projectId: OURS }), false);
      },
    },

    // ─── the pid record's shelf life ───

    {
      name: 'a-fresh-pid-record-is-evidence',
      async run({ assert }) {
        const record = { pids: [37088, 37360], projectId: OURS, rootPid: 34965, ports: { firestore: 8080 }, startedAt: new Date().toISOString() };

        assert.deepEqual(ownershipFromRecord(record), { pids: [37088, 37360], projectId: OURS, rootPid: 34965, ports: { firestore: 8080 } });
      },
    },

    {
      name: 'a-stale-records-pids-are-not-evidence-anymore',
      async run({ assert }) {
        // The record is never deleted, so a run days later still read the last
        // one. Pids get RECYCLED: those numbers now name whatever the OS
        // handed them to, and the sweep SIGKILLs a recorded pid without
        // looking at anything else. The project-id proof is not pid-based and
        // survives.
        const record = {
          pids: [37088, 37360],
          projectId: OURS,
          rootPid: 34965,
          startedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
        };

        assert.deepEqual(ownershipFromRecord(record), { pids: [], projectId: OURS, rootPid: 34965, ports: {} });
      },
    },

    {
      name: 'a-record-that-cannot-date-itself-is-not-evidence',
      async run({ assert }) {
        // A record written before startedAt existed, or a half-written one:
        // unknown age is treated as expired, never as fresh.
        assert.deepEqual(ownershipFromRecord({ pids: [37088], projectId: OURS }).pids, []);
        assert.deepEqual(ownershipFromRecord({ pids: [37088], projectId: OURS, startedAt: 'whenever' }).pids, []);
        assert.deepEqual(ownershipFromRecord(null), { pids: [], projectId: null, rootPid: null, ports: {} });
        assert.deepEqual(ownershipFromRecord({ pids: 'nope', startedAt: new Date().toISOString() }).pids, []);
      },
    },

    {
      name: 'a-stale-record-still-spares-everything-it-cannot-prove',
      async run({ assert }) {
        // The whole point of expiring the pids: the recycled pid stops being a
        // kill order and the process is judged on its command line alone.
        const stale = ownershipFromRecord({
          pids: [60001],
          projectId: OURS,
          startedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
        });

        assert.equal(isOwnedEmulatorProcess({ pid: 60001, command: RELOAD_WATCHER }, stale), false);
        assert.equal(isOwnedEmulatorProcess({ pid: 37088, command: FIRESTORE_JAR }, stale), true, 'the command-line proof is untouched');
      },
    },
  ],
});
