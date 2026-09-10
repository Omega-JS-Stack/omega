/**
 * Test: `omega -i` / `omega -u` dispatch install and update
 * ([#81](https://github.com/Omega-JS-Stack/omega/issues/81) parity sweep).
 *
 * Every router framework spells these `install: ['-i', 'i', '--install']` and
 * `update: ['-u', '--update', 'outdated', 'out']`. Backend's table is its own
 * design but the accepted argv tokens are a cross-framework contract — a verb
 * a sibling answers must answer here too. The dispatcher matches raw argv
 * tokens verbatim, so the alias list carries the literal dashes.
 *
 * Run: npx omega test backend:cli/install-update-dispatch
 */
const { COMMANDS, MISSING_ARG, matchCommand } = require('../../dist/cli/command-table.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const installEntry = COMMANDS.find((command) => command.name === 'install');
const updateEntry = COMMANDS.find((command) => command.name === 'update');

module.exports = defineCases({
  description: 'The install and update verbs answer the flag spellings the siblings accept',
  type: 'group',

  tests: [
    {
      name: 'install-short-and-long-flags-dispatch',
      auth: 'none',

      async run({ assert }) {
        assert.equal(matchCommand(installEntry, { '-i': true, dev: true }), 'local', '`omega -i dev` resolves to install local, like every sibling CLI');
        assert.equal(matchCommand(installEntry, { '--install': true, live: true }), 'live', '`omega --install live` resolves to install live');
        assert.equal(matchCommand(installEntry, { i: true, local: true }), 'local', '`omega i local` still resolves');
        assert.equal(matchCommand(installEntry, { '-i': true }), MISSING_ARG, 'a mode-less `-i` is a missing-mode error, not an unknown command');
      },
    },
    {
      name: 'update-short-and-long-flags-dispatch',
      auth: 'none',

      async run({ assert }) {
        assert.equal(Boolean(matchCommand(updateEntry, { '-u': true })), true, '`omega -u` resolves to the update command, like every sibling CLI');
        assert.equal(Boolean(matchCommand(updateEntry, { '--update': true })), true, '`omega --update` resolves to the update command');
        assert.equal(Boolean(matchCommand(updateEntry, { outdated: true })), true, '`omega outdated` still resolves');
        assert.equal(Boolean(matchCommand(updateEntry, { out: true })), true, '`omega out` still resolves');
      },
    },
  ],
});
