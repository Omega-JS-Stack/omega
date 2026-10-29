/**
 * Test: `omega dev` (the target's `start` script) dispatches the backend's dev
 * loop, the full emulator suite, on `dev`, `start` and `--dev`; `serve` stays the
 * backend's own verb; and it runs the target checks before any boot.
 * Run: npx omega test backend:cli/dev-dispatch
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { COMMANDS, matchCommand } = require('../../dist/cli/command-table.js');
const EmulatorCommand = require('../../dist/cli/commands/emulator.js');
const DevCommand = require('../../dist/cli/commands/dev.js');
const attachLogFile = require('../../dist/cli/utils/attach-log-file.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
const package = require('../../package.json');

/** The command a token dispatches to: the table's first match, the dispatcher's own rule. */
const dispatched = (token) => COMMANDS.find((command) => matchCommand(command, { [token]: true }));

module.exports = defineCases({
  description: 'The dev verb runs the emulator suite, and serve stays its own verb',
  type: 'group',

  tests: [
    {
      name: 'dev-and-its-aliases-dispatch-to-dev',
      auth: 'none',

      async run({ expect }) {
        for (const token of ['dev', 'start', '--dev']) {
          expect(dispatched(token)?.name, `\`omega ${token}\` resolves to dev`).toBe('dev');
        }
        expect(dispatched('serve')?.name, '`omega serve` is the backend\'s own verb, never dev').toBe('serve');
        expect(dispatched('emulator')?.name, '`emulator` stays a verb').toBe('emulator');
      },
    },
    {
      name: 'dev-is-the-emulator-command',
      auth: 'none',

      async run({ expect }) {
        expect(DevCommand.prototype instanceof EmulatorCommand, 'dev boots what `omega emulator` boots').toBe(true);
      },
    },
    {
      name: 'dev-scaffolds-then-halts-in-the-target-checks-before-any-boot',
      auth: 'none',

      async run({ expect }) {
        // A bare target root (a manifest, no firebase.json) whose config carries a
        // secret-shaped key: the scaffold makes the target whole, then the checks'
        // own config load refuses it, before any boot
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-checks-'));
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'dev-checks-backend', version: '0.0.1', dependencies: { '@omega.js/backend': '*', ...package.peerDependencies } }));
        fs.mkdirSync(path.join(tempDir, 'config'));
        fs.writeFileSync(path.join(tempDir, 'config', 'omega.json5'), '{ payment: { secretKey: "sk_test_x" } }\n');
        const command = new DevCommand({ firebaseProjectPath: tempDir, default: {}, argv: { _: [] }, options: {} });

        const output = [];
        const originalLog = console.log;
        const restoreTee = attachLogFile.mark();
        // A run that reaches the boot line stops there, so a red run never spawns an emulator
        console.log = (...args) => {
          const line = args.join(' ');
          output.push(line);
          if (line.includes('Starting Firebase emulator')) throw new Error('reached the emulator boot');
        };

        let error = null;
        let scaffolded = false;
        try {
          await command.execute();
        } catch (e) {
          error = e;
        } finally {
          scaffolded = fs.existsSync(path.join(tempDir, 'firebase.json'));
          console.log = originalLog;
          restoreTee();
          fs.rmSync(tempDir, { recursive: true, force: true });
        }

        const text = output.join('\n');
        expect(error?.message, 'the checks refuse the secret-shaped config').toMatch(/Secret-shaped keys/);
        expect(scaffolded, 'the scaffold wrote firebase.json before the checks ran').toBe(true);
        expect(text, 'the checks section opened').toContain('TARGET CHECKS');
        expect(text.includes('Starting Firebase emulator'), 'no emulator boot line').toBe(false);
        expect(command.main.argv.offline, 'the checks ran offline: a dev boot never deploys a drift').toBe(true);
      },
    },
  ],
});
