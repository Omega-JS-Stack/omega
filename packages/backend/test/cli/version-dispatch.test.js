/**
 * Test: `omega --version` dispatches the version command
 * ([#81](https://github.com/Omega-JS-Stack/omega/issues/81) parity sweep).
 *
 * The dispatcher matches raw argv tokens verbatim, so the alias list must
 * carry the literal `--version` every sibling CLI accepts. A single-dash
 * `-version` is a token nobody types and no sibling documents.
 *
 * Run: npx omega test backend:cli/version-dispatch
 */
const { COMMANDS, matchCommand } = require('../../dist/cli/command-table.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const versionEntry = COMMANDS.find((command) => command.name === 'version');

module.exports = defineCases({
  description: 'The version verb answers the flag spellings the siblings accept',
  type: 'group',

  tests: [
    {
      name: 'double-dash-version-dispatches',
      auth: 'none',

      async run({ assert }) {
        assert.equal(Boolean(matchCommand(versionEntry, { '--version': true })), true, '`omega --version` resolves to the version command, like every sibling CLI');
      },
    },
    {
      name: 'short-forms-still-dispatch',
      auth: 'none',

      async run({ assert }) {
        assert.equal(Boolean(matchCommand(versionEntry, { '-v': true })), true, '`omega -v` still resolves');
        assert.equal(Boolean(matchCommand(versionEntry, { v: true })), true, '`omega v` still resolves');
      },
    },
  ],
});
