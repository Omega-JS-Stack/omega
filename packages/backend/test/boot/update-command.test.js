/**
 * `mgr update` wiring pin — the verb is the SHARED devkit implementation
 * (npu-outdated semantics, 7-day release-age quarantine); @omega.js/backend
 * only wires it into the colon-style CLI. Pins: the built command class
 * loads from dist (so the vendored devkit module resolves), the dispatcher
 * routes update and its flag spellings, and the offline core behaves (install
 * selection with an injected registry + clock — no network).
 */

const path = require('path');
const table = require('../../dist/cli/command-table.js');
const { BOOLEAN_FLAGS } = require('../../dist/cli/flags.js');
const { parseArgv } = require('../../dist/vendor/devkit/argv.js');
const UpdateCommand = require('../../dist/cli/commands/update.js');
const devkitUpdate = require('../../dist/vendor/devkit/update.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Update command — devkit-shared verb wired into the @omega.js/backend CLI',
  type: 'group',

  tests: [
    {
      name: 'dist-command-loads-and-exposes-execute',
      async run({ assert }) {
        assert.equal(typeof UpdateCommand, 'function', 'dist/cli/commands/update.js exports the command class');
        assert.equal(typeof UpdateCommand.prototype.execute, 'function', 'command class implements execute()');
      },
    },
    {
      name: 'dry-run-reaches-runUpdate-and-a-bare-run-installs',
      async run({ assert }) {
        const commandFile = path.join(__dirname, '..', '..', 'dist', 'cli', 'commands', 'update.js');

        // The command destructures runUpdate at load, so the stub lands before a fresh require
        async function run(args) {
          const original = devkitUpdate.runUpdate;
          const seen = [];
          devkitUpdate.runUpdate = async (options) => { seen.push(options); };
          delete require.cache[commandFile];
          try {
            const Command = require(commandFile);
            await new Command({ firebaseProjectPath: __dirname, argv: parseArgv(args, { booleans: BOOLEAN_FLAGS }), options: {} }).execute();
          } finally {
            devkitUpdate.runUpdate = original;
            delete require.cache[commandFile];
          }
          assert.equal(seen.length, 1, 'the command called runUpdate once');
          return seen[0];
        }

        assert.equal((await run(['update', '--dry-run'])).dryRun, true);
        assert.equal(Boolean((await run(['update'])).dryRun), false, 'a bare run is not a dry run');
      },
    },
    {
      name: 'dispatcher-routes-update',
      async run({ assert }) {
        const update = table.COMMANDS.find((command) => command.name === 'update');
        assert.ok(update, 'the command table carries the update verb');

        for (const token of ['update', '-u', '--update']) {
          assert.equal(table.matchCommand(update, { [token]: true }), true, `\`omega ${token}\` dispatches update`);
        }
      },
    },
    {
      name: 'core-semantics-hold-offline (quarantine + major hold, injected clock)',
      async run({ assert }) {
        const NOW = Date.UTC(2026, 6, 21);
        const day = (daysAgo) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

        assert.equal(devkitUpdate.DEFAULT_MIN_AGE_DAYS, 7, 'quarantine default is 7 days');

        const rows = [{
          name: 'fresh', group: 'prod', current: '1.0.0', installed: '1.0.0',
          wanted: '1.1.0', latest: '1.1.0', minorTarget: '1.1.0', bump: 'minor',
          time: { '1.1.0': day(2) }, error: null,
        }, {
          name: 'breaking', group: 'prod', current: '1.0.0', installed: '1.0.0',
          wanted: '1.0.0', latest: '2.0.0', minorTarget: '1.0.0', bump: 'major',
          time: { '2.0.0': day(90) }, error: null,
        }];

        const selection = devkitUpdate.selectUpdates(rows, { minAge: 7, now: NOW });
        assert.equal(selection.updates.length, 0, 'fresh release quarantined, major held');
        assert.equal(selection.quarantined[0].name, 'fresh');
        assert.equal(selection.majorsHeld[0].name, 'breaking');
      },
    },
  ],
});
