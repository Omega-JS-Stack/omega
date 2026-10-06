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
const { COMMANDS, tokensOf, matchCommand, defaultCommand, buildHelpText } = require('../../dist/cli/command-table.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'The setup command is retired — the verbs carry its work',
  type: 'group',

  tests: [
    {
      name: 'no-setup-entry-in-the-table',
      auth: 'none',

      async run({ expect }) {
        const tokens = COMMANDS.flatMap(tokensOf);

        expect(tokens.includes('setup'), 'nothing dispatches `omega setup`').toBe(false);
        expect(buildHelpText().includes('setup'), 'nothing lists it either').toBe(false);
      },
    },

    {
      name: 'no-command-claims-the-default-slot',
      auth: 'none',

      async run({ expect }) {
        expect(COMMANDS.some((command) => command.default), 'setup was the only default — nothing inherits the slot').toBe(false);
        expect(defaultCommand(), 'defaultCommand() answers "none" instead of throwing').toBe(undefined);
      },
    },

    {
      name: 'a-bare-invocation-resolves-to-help',
      auth: 'none',

      async run({ expect }) {
        const help = COMMANDS.find((command) => command.name === 'help');
        const lines = [];
        const original = console.log;

        console.log = (...args) => lines.push(args.map(String).join(' '));
        try {
          help.run();
        } finally {
          console.log = original;
        }

        expect(lines.join('\n'), 'the fallback prints the listing').toMatch(/^Usage: omega <command>/);
        expect(matchCommand(help, {}), 'help still only matches when it is named').toBe(false);
      },
    },
  ],
});
