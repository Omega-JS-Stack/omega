/**
 * Test: `omega dev` (the target's `start` script) dispatches the backend's dev
 * loop, the full emulator suite, on `dev`, `start` and `--dev`; `serve` stays the
 * backend's own verb. Run: npx omega test backend:cli/dev-dispatch
 */
const { COMMANDS, matchCommand } = require('../../dist/cli/command-table.js');
const EmulatorCommand = require('../../dist/cli/commands/emulator.js');
const DevCommand = require('../../dist/cli/commands/dev.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

/** The command a token dispatches to: the table's first match, the dispatcher's own rule. */
const dispatched = (token) => COMMANDS.find((command) => matchCommand(command, { [token]: true }));

module.exports = defineCases({
  description: 'The dev verb runs the emulator suite, and serve stays its own verb',
  type: 'group',

  tests: [
    {
      name: 'dev-and-its-aliases-dispatch-to-dev',
      auth: 'none',

      async run({ assert }) {
        for (const token of ['dev', 'start', '--dev']) {
          assert.equal(dispatched(token)?.name, 'dev', `\`omega ${token}\` resolves to dev`);
        }
        assert.equal(dispatched('serve')?.name, 'serve', '`omega serve` is the backend\'s own verb, never dev');
        assert.equal(dispatched('emulator')?.name, 'emulator', '`emulator` stays a verb');
      },
    },
    {
      name: 'dev-is-the-emulator-command',
      auth: 'none',

      async run({ assert }) {
        assert.equal(DevCommand.prototype instanceof EmulatorCommand, true, 'dev boots what `omega emulator` boots');
      },
    },
  ],
});
