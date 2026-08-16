/**
 * Test: the adopt-or-bump decision for an already-running emulator
 * ([#258](https://github.com/Omega-JS-Stack/omega/issues/258)).
 *
 * `omega test` used to decide on a bare port probe: something is listening on
 * the functions port, therefore it is OUR emulator. With another brand's stack
 * up, the run adopted a FOREIGN emulator and died on a health fetch instead of
 * booting its own on bumped ports — which the N7 allocator already does
 * correctly one branch over.
 *
 * Run: npx omega test backend:cli/emulator-adoption
 *
 * The decision is pure (port evidence + two project ids), so it runs here
 * directly. So is the identity READ below it: firebase-tools publishes the
 * running hub's identity as a FILE, so proving it takes real files and real
 * pids, not a live emulator. The bump itself is the emulator's own machinery,
 * exercised by every emulator-backed suite.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const jetpack = require('fs-jetpack');

const TestCommand = require('../../src/cli/commands/test.js');

const { decideEmulatorAdoption, readHubLocatorProjectId } = TestCommand;

const OURS = 'demo-sandbox-brand';
const THEIRS = 'demo-other-brand';

const HUB_PORT = 4400;

// The locator firebase-tools writes to os.tmpdir() while a hub is up: the
// REAL shape, copied from `${os.tmpdir()}/hub-demo-sandbox-brand.json` of a
// booted sandbox emulator.
function locator(port, pid) {
  return {
    version: '15.24.0',
    origins: [`http://127.0.0.1:${port}`, `http://[::1]:${port}`],
    pid: pid,
  };
}

// A REAL dead pid — a process that ran and exited — so "is this pid alive"
// answers for real instead of against an invented number.
function deadPid() {
  return spawnSync('true').pid;
}

// Each case gets its own tmp dir: these are fixtures for ONE read, and a
// leftover locator would answer a later case's question.
async function withTmpDir(fn) {
  const dir = jetpack.tmpDir().path();

  try {
    return await fn(dir);
  } finally {
    jetpack.remove(dir);
  }
}

module.exports = {
  description: 'omega test adopt-or-bump decision for a running emulator',
  type: 'group',

  tests: [
    {
      name: 'a-free-port-means-boot-our-own',
      async run({ assert }) {
        const decision = decideEmulatorAdoption({
          portInUse: false,
          runningProjectId: null,
          expectedProjectId: OURS,
        });

        assert.equal(decision.adopt, false);
        assert.equal(decision.reason, 'no-emulator');
      },
    },

    {
      name: 'our-own-emulator-is-adopted',
      async run({ assert }) {
        const decision = decideEmulatorAdoption({
          portInUse: true,
          runningProjectId: OURS,
          expectedProjectId: OURS,
        });

        assert.equal(decision.adopt, true);
        assert.equal(decision.reason, 'project-match');
      },
    },

    {
      name: 'another-brands-emulator-is-never-adopted',
      async run({ assert }) {
        // The reported case: the omega playground's emulator on the classic
        // ports while the run belongs to a different project.
        const decision = decideEmulatorAdoption({
          portInUse: true,
          runningProjectId: THEIRS,
          expectedProjectId: OURS,
        });

        assert.equal(decision.adopt, false);
        assert.equal(decision.reason, 'project-mismatch');
        assert.equal(decision.runningProjectId, THEIRS, 'the decision names the incumbent so the log can too');
      },
    },

    {
      name: 'our-own-live-ports-file-is-proof-on-its-own',
      async run({ assert }) {
        // This project's .temp/ports.json is written by OUR emulator and only
        // survives while its writer is alive. It is the proof that holds when
        // the hub cannot answer for us — the hub sits on a fixed port, so a
        // run whose emulator bumped shares it with whoever booted first.
        const decision = decideEmulatorAdoption({
          portInUse: true,
          ownsPortsFile: true,
          runningProjectId: THEIRS,
          expectedProjectId: OURS,
        });

        assert.equal(decision.adopt, true);
        assert.equal(decision.reason, 'ports-file');
      },
    },

    {
      name: 'an-unidentifiable-listener-is-never-adopted',
      async run({ assert }) {
        // Identity unreadable (no hub answer, no metadata): something is on the
        // port but nothing proves it is ours. Booting our own on bumped ports
        // costs a boot; adopting a stranger costs the whole run.
        const decision = decideEmulatorAdoption({
          portInUse: true,
          runningProjectId: null,
          expectedProjectId: OURS,
        });

        assert.equal(decision.adopt, false);
        assert.equal(decision.reason, 'unidentified');
      },
    },

    {
      name: 'a-run-with-no-project-id-of-its-own-cannot-claim-a-match',
      async run({ assert }) {
        // Nothing to compare against is not evidence of ownership.
        const decision = decideEmulatorAdoption({
          portInUse: true,
          runningProjectId: OURS,
          expectedProjectId: null,
        });

        assert.equal(decision.adopt, false);
        assert.equal(decision.reason, 'unidentified');
      },
    },

    // ─── the identity read the decision runs on ───

    {
      name: 'the-hub-locator-file-names-the-running-project',
      async run({ assert }) {
        // The read used to ask the hub's GET /emulators for a `projectId` it
        // has never returned (the body is a map of emulator → listen info), so
        // it answered null for every emulator alive and the project-match
        // branch below could not be reached. The identity firebase-tools
        // actually publishes is this file
        // ([#258](https://github.com/Omega-JS-Stack/omega/issues/258)).
        await withTmpDir(async (dir) => {
          jetpack.write(path.join(dir, `hub-${OURS}.json`), locator(HUB_PORT, process.pid));

          assert.equal(readHubLocatorProjectId(HUB_PORT, dir), OURS);
        });
      },
    },

    {
      name: 'a-locator-published-on-another-port-is-a-different-hub',
      async run({ assert }) {
        // A bumped run's hub is a hub, just not the one on the port we probed.
        await withTmpDir(async (dir) => {
          jetpack.write(path.join(dir, `hub-${THEIRS}.json`), locator(4401, process.pid));

          assert.equal(readHubLocatorProjectId(HUB_PORT, dir), null);
        });
      },
    },

    {
      name: 'a-crashed-runs-leftover-locator-proves-nothing',
      async run({ assert }) {
        // firebase-tools does not always clean the file up. A dead pid is the
        // tell: the file names a hub that is gone, so whatever holds the port
        // now is somebody else and stays unidentified.
        await withTmpDir(async (dir) => {
          jetpack.write(path.join(dir, `hub-${OURS}.json`), locator(HUB_PORT, deadPid()));

          assert.equal(readHubLocatorProjectId(HUB_PORT, dir), null);
        });
      },
    },

    {
      name: 'two-live-candidates-for-one-port-are-ambiguous',
      async run({ assert }) {
        // A stale file whose pid got RECYCLED reads as live. With two live
        // claims on one port at most one is true and nothing says which —
        // answering "ours" there is exactly the adoption #258 is about.
        await withTmpDir(async (dir) => {
          jetpack.write(path.join(dir, `hub-${OURS}.json`), locator(HUB_PORT, process.pid));
          jetpack.write(path.join(dir, `hub-${THEIRS}.json`), locator(HUB_PORT, process.pid));

          assert.equal(readHubLocatorProjectId(HUB_PORT, dir), null);
        });
      },
    },

    {
      name: 'no-locator-or-an-unreadable-one-is-unproven-never-ours',
      async run({ assert }) {
        // The safe fall-through: every unreadable case answers null, which the
        // decision reads as "unidentified" and boots on bumped ports.
        await withTmpDir(async (dir) => {
          assert.equal(readHubLocatorProjectId(HUB_PORT, dir), null, 'an empty tmp dir');

          jetpack.write(path.join(dir, `hub-${OURS}.json`), 'not json at all');
          jetpack.write(path.join(dir, `hub-${THEIRS}.json`), { version: '15.24.0' });

          assert.equal(readHubLocatorProjectId(HUB_PORT, dir), null, 'a malformed locator');
          assert.equal(readHubLocatorProjectId(HUB_PORT, path.join(dir, 'nope')), null, 'a missing tmp dir');
        });
      },
    },

    {
      name: 'the-locator-file-name-is-the-project-id-verbatim',
      async run({ assert }) {
        // Project ids carry dots and dashes; the name is everything between
        // `hub-` and `.json`, never a truncation at the first separator.
        await withTmpDir(async (dir) => {
          jetpack.write(path.join(dir, 'hub-my.brand-staging.json'), locator(HUB_PORT, process.pid));
          jetpack.write(path.join(dir, 'unrelated-tool.json'), locator(HUB_PORT, process.pid));

          assert.equal(readHubLocatorProjectId(HUB_PORT, dir), 'my.brand-staging');
        });
      },
    },
  ],
};
