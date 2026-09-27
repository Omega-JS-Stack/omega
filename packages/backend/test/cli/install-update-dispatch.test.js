/**
 * Test: `omega -u` dispatches update
 * ([#81](https://github.com/Omega-JS-Stack/omega/issues/81) parity sweep).
 *
 * Every router framework spells this `update: ['-u', '--update']`. Backend's table is its own
 * design but the accepted argv tokens are a cross-framework contract — a verb
 * a sibling answers must answer here too. The dispatcher matches raw argv
 * tokens verbatim, so the alias list carries the literal dashes.
 *
 * Run: npx omega test backend:cli/install-update-dispatch
 */
const { COMMANDS, matchCommand } = require('../../dist/cli/command-table.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const updateEntry = COMMANDS.find((command) => command.name === 'update');

module.exports = defineCases({
  description: 'The update verb answers the flag spellings the siblings accept',
  type: 'group',

  tests: [
    {
      name: 'update-short-and-long-flags-dispatch',
      auth: 'none',

      async run({ assert }) {
        assert.equal(Boolean(matchCommand(updateEntry, { '-u': true })), true, '`omega -u` resolves to the update command, like every sibling CLI');
        assert.equal(Boolean(matchCommand(updateEntry, { '--update': true })), true, '`omega --update` resolves to the update command');
        assert.equal(Boolean(matchCommand(updateEntry, { outdated: true })), false, '`omega outdated` is retired: a bare update installs');
        assert.equal(Boolean(matchCommand(updateEntry, { out: true })), false, '`omega out` is retired with it');
      },
    },
  ],
});
