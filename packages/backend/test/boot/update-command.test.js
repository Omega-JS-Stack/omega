/**
 * `mgr update` wiring pin — the verb is the SHARED devkit implementation
 * (npu-outdated semantics, 7-day release-age quarantine); @omega.js/backend
 * only wires it into the colon-style CLI. Pins: the built command class
 * loads from dist (so the vendored devkit module resolves), the dispatcher
 * routes update/outdated/out, and the offline core behaves (report/apply
 * selection with an injected registry + clock — no network).
 */

const table = require('../../dist/cli/command-table.js');
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
      name: 'dispatcher-routes-update-outdated-out',
      async run({ assert }) {
        const update = table.COMMANDS.find((command) => command.name === 'update');
        assert.ok(update, 'the command table carries the update verb');

        for (const token of ['update', 'outdated', 'out']) {
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
