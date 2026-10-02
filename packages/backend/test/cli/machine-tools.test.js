/**
 * Test: the backend reads its machine tools from the one devkit list.
 *
 * The emulator test lane cannot run without Java and the Firebase CLI, so it
 * refuses with the list's one line and exit code 1. A custom backend has no
 * emulator, so its setup checks drop the Java and Firebase CLI checks.
 *
 * The missing tool is a real PATH with nothing on it, so the lane's own probe
 * finds nothing and no case touches this machine's java or firebase.
 *
 * Run: npx omega test backend:cli/machine-tools
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MACHINE_TOOLS, machineToolLine } = require('../../dist/vendor/devkit/machine-tools.js');
const { FIREBASE_ONLY_SETUP_CHECKS } = require('../../dist/cli/utils/project-type.js');
const TestCommand = require('../../dist/cli/commands/test.js');
const { getTests } = require('../../dist/cli/commands/setup-tests/index.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/** A backend target named `backend` on disk, its project type as given (omitted = firebase). */
function targetDir({ projectType } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-machine-tools-')));
  const backend = projectType ? { type: 'backend', projectType } : { type: 'backend' };

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '0.0.0' }));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    targets: { backend },
  }));
  return dir;
}

/** The target checks a target actually runs, by class name. */
function setupCheckNames(dir) {
  return getTests({ main: { firebaseProjectPath: dir } }).map((test) => test.constructor.name);
}

/**
 * Run `fn` with an empty PATH, the console captured and process.exit recorded.
 * Resolves the printed output and the exit code the run ended on.
 */
async function withoutMachineTools(fn) {
  const lines = [];
  const methods = ['log', 'warn', 'error'];
  const originals = methods.map((method) => console[method]);
  const saved = { path: process.env.PATH, exit: process.exit, exitCode: process.exitCode };
  const exits = [];
  let thrown = null;
  let exitCode;

  process.env.PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-empty-path-'));
  methods.forEach((method) => { console[method] = (...args) => lines.push(args.map(String).join(' ')); });
  // An exit is the run's end, so it stops here instead of ending the test process
  process.exit = (code) => {
    exits.push(code ?? 0);
    throw Object.assign(new Error('process.exit'), { exited: true });
  };
  try {
    await fn();
  } catch (error) {
    if (!error.exited) thrown = error;
  } finally {
    methods.forEach((method, i) => { console[method] = originals[i]; });
    exitCode = process.exitCode;
    process.env.PATH = saved.path;
    process.exit = saved.exit;
    process.exitCode = saved.exitCode;
  }
  // A thrown error is exit 1 through the CLI router; an explicit exit wins
  const code = exits.length ? exits[exits.length - 1] : (thrown ? 1 : exitCode);
  return { output: [...lines, thrown ? thrown.message : ''].join('\n'), code };
}

module.exports = defineCases({
  description: 'Backend machine tools (#1032): the emulator lane refuses on a missing tool, a custom backend skips the tool checks',
  type: 'group',

  tests: [
    {
      name: 'the emulator test lane with Java missing refuses with the line and exit code 1',

      async run() {
        const dir = targetDir();
        const java = MACHINE_TOOLS.backend.find((tool) => tool.name === 'java');
        const line = machineToolLine({ target: 'backend', type: 'backend', name: java.name, why: java.why, install: java.install[process.platform] });

        try {
          const run = await withoutMachineTools(() => new TestCommand({ firebaseProjectPath: dir, argv: { _: [] }, options: {} }).runEmulatorTests({}, dir));

          assert.ok(run.output.includes(line), `the refusal is the list's one line: ${run.output}`);
          assert.strictEqual(run.code, 1, 'a refused lane fails the process');
          assert.doesNotMatch(run.output, /Starting Firebase emulator/, 'the refusal comes before the emulator boot');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a custom backend runs no Java or Firebase CLI setup check, a Firebase backend runs both',

      run() {
        const custom = targetDir({ projectType: 'custom' });
        const firebase = targetDir();

        try {
          for (const check of ['java-installed', 'firebase-cli']) {
            assert.ok(FIREBASE_ONLY_SETUP_CHECKS.includes(check), `${check} is in the Firebase-only set`);
          }

          const kept = setupCheckNames(custom);
          assert.strictEqual(kept.includes('JavaInstalledTest'), false, 'a custom backend has no emulator to need Java');
          assert.strictEqual(kept.includes('FirebaseCliTest'), false, 'a custom backend never calls the Firebase CLI');

          const full = setupCheckNames(firebase);
          assert.strictEqual(full.includes('JavaInstalledTest'), true);
          assert.strictEqual(full.includes('FirebaseCliTest'), true);
        } finally {
          for (const dir of [custom, firebase]) fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ],
});
