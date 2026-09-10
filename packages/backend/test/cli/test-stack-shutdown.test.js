/**
 * Test: the stack `omega test` starts for itself goes down on EVERY stop signal
 * ([#722](https://github.com/Omega-JS-Stack/omega/issues/722)).
 *
 * `omega test` boots its own emulator when there is none to adopt, and it wired
 * the teardown to SIGINT alone. A run stopped any other way — a supervisor's
 * SIGTERM, a closed terminal's SIGHUP — took Node's default action instead: the
 * CLI process died where it stood and the whole firebase tree it had spawned
 * reparented to PID 1, exactly the [#629](https://github.com/Omega-JS-Stack/omega/issues/629)
 * defect on the sibling path.
 *
 * Run: npx omega test backend:cli/test-stack-shutdown
 *
 * The run under test is a REAL child process, detached into its own process
 * group: a signal is only a signal when it arrives at a process, and an
 * in-process case can call the stop path but never prove SIGHUP reaches it. No
 * emulator is booted — startEmulators is the one seam replaced, because what
 * the signal path owes its caller is decided by what it does with the HANDLE,
 * not by how the handle came to be. The test runner it spawns is a `sleep`, so
 * the run idles the way a real one does while its suites run.
 */
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The run, in its own process. startEmulators hands back the same three things
// a real boot does — a shutdown, a promise that never settles on its own (the
// child outlives the suites), and a resolved port map — and records the one
// thing under test: whether the teardown was reached at all.
const SIGNAL_DRIVER = `
const fs = require('fs');
const [, , commandPath, emulatorPath, projectDir, statePath, readyPath] = process.argv;

const TestCommand = require(commandPath);
const EmulatorCommand = require(emulatorPath);

EmulatorCommand.prototype.startEmulators = async () => ({
  // Slow on purpose: a real teardown signals a tree and waits on ports, and a
  // second stop signal arriving DURING it is the case the handler must survive.
  shutdown: async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.appendFileSync(statePath, 'shutdown\\n');
  },
  exitPromise: new Promise(() => {}),
  emulatorPorts: { hosting: 15002, firestore: 18080, auth: 19099, ui: 14000 },
});

const command = new TestCommand({ firebaseProjectPath: projectDir, argv: {}, options: {} });

// 'Logs saving to' is the last line the run prints before it settles into
// waiting on its test child — and it prints AFTER the stop handlers are
// registered, which is what the parent must not race. 'Shutting down' is the
// handler's own first line, so the state file counts how many times the
// teardown was ENTERED, not just whether it finished.
command.log = (message) => {
  const text = String(message);

  if (/Shutting down emulator/.test(text)) fs.appendFileSync(statePath, 'teardown\\n');
  if (/Logs saving to/.test(text)) fs.writeFileSync(readyPath, 'ready');
};
command.logError = () => {};
command.logWarning = () => {};
command.startLane = async () => ({ env: {}, stop: () => {} });
command.buildTestCommand = () => 'sleep 30';

command.runEmulatorTests({}, projectDir).catch(() => {});
`;

/**
 * Poll until `check` passes or the window closes.
 * @param {Function} check - Returns truthy when the wait is over.
 * @param {number} timeoutMs - How long to keep looking.
 * @returns {Promise<boolean>} Whether it passed inside the window.
 */
async function waitUntil(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }

    await powertools.wait(50);
  }

  return check();
}

/**
 * The command line a pid is running right now, or '' when it is gone.
 * @param {number} pid - The pid to read.
 * @returns {string}
 */
function commandOf(pid) {
  try {
    return execSync(`ps -o command= -p ${Number(pid)} 2>/dev/null`, { encoding: 'utf8' }).trim();
  } catch (error) {
    return '';
  }
}

/**
 * The run's ONE child: the test runner it spawned. Read from the process table
 * rather than reported by the driver, because what is on trial is whether a
 * real process is still there after the run is gone.
 * @param {number} pid - The run's pid.
 * @returns {number|null}
 */
function testRunnerPid(pid) {
  try {
    const found = execSync(`pgrep -P ${Number(pid)} 2>/dev/null`, { encoding: 'utf8' }).trim().split('\n')[0];
    return found ? Number(found) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Boot the driver and wait for the run to reach the point where it is waiting
 * on its test child — stop handlers registered, stack "up".
 */
async function bootedRun() {
  const dir = path.join(os.tmpdir(), `omega-test-signal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const statePath = path.join(dir, 'state.txt');
  const readyPath = path.join(dir, 'ready.txt');

  // getLogsPath() writes test.log into dist/ — the one real directory the run
  // touches, inside this throwaway project.
  jetpack.dir(path.join(dir, 'dist'));
  jetpack.write(path.join(dir, 'driver.js'), SIGNAL_DRIVER);

  // Detached: the run gets its OWN process group, so the signal below lands on
  // that ONE process and nothing else — the strictly harder case, and the one
  // a supervisor's stop and a closed terminal both produce.
  const child = spawn(process.execPath, [
    path.join(dir, 'driver.js'),
    require.resolve('../../dist/cli/commands/test.js'),
    require.resolve('../../dist/cli/commands/emulator.js'),
    dir,
    statePath,
    readyPath,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let output = '';
  child.stdout.on('data', (data) => { output += data.toString(); });
  child.stderr.on('data', (data) => { output += data.toString(); });

  let exit = null;
  child.once('exit', (code, signal) => { exit = { code: code, signal: signal }; });

  const ready = await waitUntil(() => jetpack.exists(readyPath), 60000);

  // The test runner is spawned on the very next line the run executes, and it
  // is the half of the stack the signal does NOT reach on its own.
  let runnerPid = null;
  await waitUntil(() => {
    runnerPid = testRunnerPid(child.pid);
    return runnerPid !== null;
  }, 30000);

  return {
    child: child,
    ready: ready,
    runnerPid: runnerPid,
    output: () => output,
    exit: () => exit,
    state: () => String(jetpack.read(statePath) || ''),
    cleanup: () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
      try { process.kill(child.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
      jetpack.remove(dir);
    },
  };
}

/**
 * Boot the run, signal it, and prove it took its teardown instead of dying.
 * The only process signalled is the one this case spawned.
 * @param {object} assert - The case assertions.
 * @param {string} signal - The stop signal under test.
 */
async function tearsDownOn(assert, signal) {
  const run = await bootedRun();

  try {
    assert.equal(run.ready, true, `the run must come up before it can be stopped: ${run.output()}`);
    assert.equal(typeof run.runnerPid, 'number', `the run must reach its test runner before it is stopped: ${run.output()}`);

    process.kill(run.child.pid, signal);

    assert.equal(await waitUntil(() => run.exit() !== null, 30000), true, `the run must exit on ${signal}: ${run.output()}`);
    assert.equal(run.state().includes('shutdown'), true, `${signal} must run the emulator teardown, not Node's default action`);
    assert.equal(run.exit().code, 130, `a signalled run exits 130 on ${signal}, got ${JSON.stringify(run.exit())}`);

    // The signal is DIRECTED at the CLI pid, so it never reaches the test
    // runner: unless the teardown takes the child down itself, the suites keep
    // running orphaned to PID 1 long after the run that owns them is gone.
    const runnerGone = await waitUntil(() => !commandOf(run.runnerPid), 10000);
    assert.equal(runnerGone, true, `${signal} must take the test runner down too — pid ${run.runnerPid} still running ${JSON.stringify(commandOf(run.runnerPid))}`);
  } finally {
    run.cleanup();
  }
}

module.exports = defineCases({
  description: 'omega test: the auto-started emulator stack goes down on every stop signal',
  type: 'group',
  timeout: 120000,

  tests: [
    {
      name: 'ctrl-c-tears-the-auto-started-stack-down',
      timeout: 120000,
      async run({ assert }) {
        // The one signal this path always handled — it must survive the trio.
        await tearsDownOn(assert, 'SIGINT');
      },
    },

    {
      name: 'a-programmatic-stop-tears-the-auto-started-stack-down',
      timeout: 120000,
      async run({ assert }) {
        // SIGTERM is how anything but a terminal stops a run: a supervisor, a
        // harness, `kill` with no flag. It killed the CLI outright and left the
        // emulator it had spawned behind.
        await tearsDownOn(assert, 'SIGTERM');
      },
    },

    {
      name: 'a-closed-terminal-tears-the-auto-started-stack-down',
      timeout: 120000,
      async run({ assert }) {
        // Closing the window on a running `omega test` sends SIGHUP, and it
        // orphaned the same tree onto PID 1.
        await tearsDownOn(assert, 'SIGHUP');
      },
    },

    {
      name: 'a-second-stop-signal-does-not-start-a-second-teardown',
      timeout: 120000,
      async run({ assert }) {
        // Impatient Ctrl+C, and a supervisor's escalation, both send a second
        // signal while the first teardown is still running. Unguarded, the
        // handler runs again underneath it and tears the same stack down twice.
        const run = await bootedRun();

        try {
          assert.equal(run.ready, true, `the run must come up before it can be stopped: ${run.output()}`);

          process.kill(run.child.pid, 'SIGINT');
          await powertools.wait(100);

          assert.equal(run.exit(), null, 'the second signal must land while the first teardown is still running');
          try { process.kill(run.child.pid, 'SIGINT'); } catch (e) { /* raced the exit */ }

          assert.equal(await waitUntil(() => run.exit() !== null, 30000), true, `the run must exit: ${run.output()}`);
          assert.equal(run.state().split('teardown').length - 1, 1, `the teardown is ENTERED once, got ${JSON.stringify(run.state())}`);
          assert.equal(run.state().includes('shutdown'), true, `the one teardown still runs to completion, got ${JSON.stringify(run.state())}`);
        } finally {
          run.cleanup();
        }
      },
    },
  ],
});
