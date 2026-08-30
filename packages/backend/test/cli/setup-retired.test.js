/**
 * Test: `omega setup` is retired
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * Nothing dispatches it, nothing lists it, and a bare `omega` at a backend
 * target prints the help listing instead of running a command nobody asked
 * for. The work it did rides the verbs now: the local scaffold in
 * `ensureTarget()` (every verb, through ensureStaged) and the target checks
 * in `omega test`.
 *
 * Run: npx omega test backend:cli/setup-retired
 */
const { COMMANDS, tokensOf, matchCommand, defaultCommand, buildHelpText } = require('../../src/cli/command-table.js');

module.exports = {
  description: 'The setup command is retired — the verbs carry its work',
  type: 'group',

  tests: [
    {
      name: 'no-setup-entry-in-the-table',
      auth: 'none',

      async run({ assert }) {
        const tokens = COMMANDS.flatMap(tokensOf);

        assert.equal(tokens.includes('setup'), false, 'nothing dispatches `omega setup`');
        assert.equal(buildHelpText().includes('setup'), false, 'nothing lists it either');
      },
    },

    {
      name: 'no-command-claims-the-default-slot',
      auth: 'none',

      async run({ assert }) {
        assert.equal(COMMANDS.some((command) => command.default), false, 'setup was the only default — nothing inherits the slot');
        assert.equal(defaultCommand(), undefined, 'defaultCommand() answers "none" instead of throwing');
      },
    },

    {
      name: 'a-bare-invocation-resolves-to-help',
      auth: 'none',

      async run({ assert }) {
        const help = COMMANDS.find((command) => command.name === 'help');
        const lines = [];
        const original = console.log;

        console.log = (...args) => lines.push(args.map(String).join(' '));
        try {
          help.run();
        } finally {
          console.log = original;
        }

        assert.match(lines.join('\n'), /^Usage: omega <command>/, 'the fallback prints the listing');
        assert.equal(matchCommand(help, {}), false, 'help still only matches when it is named');
      },
    },
  ],
};
