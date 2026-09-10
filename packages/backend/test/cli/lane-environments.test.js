/**
 * Test: every local lane NAMES the environment it stages for
 * ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)).
 *
 * dist/.env is composed for ONE environment, and the lane that stages it is
 * the only thing that knows which: an emulator/serve/mcp boot is the
 * `development` lane, `omega test`'s auto-start names `testing`, a deploy
 * names `production`. Left to a default, the answer would come from
 * envEnvironment() — the SHELL's incidental signal — so a CI shell or an
 * exported ENVIRONMENT could stage production credentials into a local run.
 *
 * Each lane is driven for real up to its staging call and stopped there by a
 * sentinel: nothing here boots an emulator, spawns firebase, or listens.
 *
 * Run: npx omega test backend:cli/lane-environments
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');

const EmulatorCommand = require('../../dist/cli/commands/emulator.js');
const ServeCommand = require('../../dist/cli/commands/serve.js');
const McpCommand = require('../../dist/cli/commands/mcp.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// Thrown from the LAST staging seam a lane calls: the boot stops there, so no
// port is bound, no child spawns, and no server listens.
class StagedHere extends Error {}

/** A throwaway backend target root whose emulator ports are nowhere near the classic map. */
function makeProject() {
  const projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lane-env-')));
  const base = 49000 + Math.floor(Math.random() * 8000);
  const names = ['auth', 'functions', 'firestore', 'database', 'hosting', 'storage', 'pubsub', 'ui'];
  const emulators = Object.fromEntries(names.map((name, index) => [name, { port: base + index }]));

  jetpack.write(path.join(projectDir, 'firebase.json'), JSON.stringify({ emulators }, null, 2));

  return { projectDir, cleanup: () => jetpack.remove(projectDir) };
}

/** Run a lane until its sentinel; anything else propagates. */
async function untilStaged(run) {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof StagedHere)) throw error;
  }
}

/** Record what a command's two staging seams are handed; the watch seam stops the lane. */
function captureStaging(command) {
  const staged = [];

  command.log = () => {};
  command.logWarning = () => {};
  command.ensureStaged = (options) => { staged.push({ call: 'ensureStaged', ...options }); };
  command.startStageWatch = (options) => { staged.push({ call: 'startStageWatch', ...options }); throw new StagedHere(); };

  return staged;
}

module.exports = defineCases({
  description: 'Every local lane stages for the environment it pins (#586)',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'the-emulator-lane-stages-development-unless-a-caller-names-one',
      auth: 'none',

      async run({ assert }) {
        const { projectDir, cleanup } = makeProject();

        try {
          const command = new EmulatorCommand({ firebaseProjectPath: projectDir, argv: { https: false, seed: false }, options: {} });
          const staged = captureStaging(command);

          await untilStaged(() => command.startEmulators());

          assert.deepEqual(staged, [
            { call: 'ensureStaged', environment: 'development' },
            { call: 'startStageWatch', environment: 'development' },
          ], 'a plain emulator boot stages development — the stage never asks the shell');

          // `omega test`'s auto-start passes its own: the pin is a DEFAULT, not a lock
          staged.length = 0;
          await untilStaged(() => command.startEmulators({ environment: 'testing' }));

          assert.deepEqual(staged, [
            { call: 'ensureStaged', environment: 'testing' },
            { call: 'startStageWatch', environment: 'testing' },
          ], "an explicit environment still wins (`omega test` names testing)");
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'the-serve-lane-stages-development',
      auth: 'none',

      async run({ assert }) {
        const { projectDir, cleanup } = makeProject();

        try {
          const command = new ServeCommand({ firebaseProjectPath: projectDir, argv: { https: false }, options: {} });
          const staged = captureStaging(command);
          command.attachVerbLog = () => '';
          command.sweepStaleLogs = () => {};

          await untilStaged(() => command.execute());

          assert.deepEqual(staged, [
            { call: 'ensureStaged', environment: 'development' },
            { call: 'startStageWatch', environment: 'development' },
          ], 'serve is the same local lane as the emulator — same overlay');
        } finally {
          cleanup();
        }
      },
    },

    {
      name: 'the-mcp-lane-stages-development-and-reads-the-same-overlay',
      auth: 'none',

      async run({ assert }) {
        const { projectDir, cleanup } = makeProject();
        const config = require('../../dist/vendor/config/index.js');
        const realLoadEnv = config.loadEnv;
        const staged = [];

        try {
          const command = new McpCommand({ firebaseProjectPath: projectDir, argv: {}, options: {} });
          command.log = () => {};
          command.ensureStaged = (options) => { staged.push({ call: 'ensureStaged', ...options }); };
          // The MCP server re-stages dist/ and then READS it: both halves must
          // name the same environment or the process would read an overlay its
          // own stage did not compose.
          config.loadEnv = (startDir, options) => { staged.push({ call: 'loadEnv', ...options }); throw new StagedHere(); };

          await untilStaged(() => command.execute());

          assert.deepEqual(staged, [
            { call: 'ensureStaged', environment: 'development' },
            { call: 'loadEnv', environment: 'development' },
          ], 'the mcp lane stages development and reads the env it just staged');
        } finally {
          config.loadEnv = realLoadEnv;
          cleanup();
        }
      },
    },
  ],
});
