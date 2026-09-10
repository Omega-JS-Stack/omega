/**
 * CLI dispatch pins — the tail of Main.process()'s dispatch loop. The old chain
 * had no terminal branch: bare `omega` and any unknown command returned
 * undefined and exited 0 in silence. Pins: help never falls through to a
 * command, the unknown path names the command and sets a failing exit code,
 * bare invocation prints the listing (since #675 retired `setup` no entry
 * claims the default slot), and `clean` is accepted bare alongside `clean:npm`.
 *
 * Plus the issue #20 pin: help is GENERATED from the command table both halves
 * read, so a command can never dispatch without appearing in the listing.
 */

const Main = require('../../dist/cli/index.js');
const table = require('../../dist/cli/command-table.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// Capture console + exit code around a process() call, restoring after.
async function captured(fn) {
  const out = [];
  const err = [];
  const origLog = console.log;
  const origError = console.error;
  const origExitCode = process.exitCode;
  console.log = (...args) => out.push(args.join(' '));
  console.error = (...args) => err.push(args.join(' '));
  try {
    await fn();
    return { out: out.join('\n'), err: err.join('\n'), exitCode: process.exitCode };
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exitCode = origExitCode;
  }
}

module.exports = defineCases({
  description: 'CLI dispatch — help, unknown-command, and default-verb behavior',
  type: 'group',

  tests: [
    {
      name: 'help-prints-the-command-listing-and-runs-nothing',
      async run({ assert }) {
        const { out, exitCode } = await captured(() => new Main().process(['node', 'script', '--help']));
        assert.ok(out.includes('Usage: omega <command>'), 'help prints the usage banner');
        assert.ok(!out.includes('setup'), 'help does not list the retired setup command');
        assert.notEqual(exitCode, 1, 'help is not an error');
      },
    },
    {
      name: 'unknown-command-prints-listing-and-sets-exit-code-1',
      async run({ assert }) {
        const { err, exitCode } = await captured(() => new Main().process(['node', 'script', 'dpeloy']));
        assert.ok(err.includes('Unknown command "dpeloy"'), 'names the unknown command');
        assert.ok(err.includes('Usage: omega <command>'), 'prints the command listing');
        assert.equal(exitCode, 1, 'unknown command is a failing exit');
      },
    },
    {
      name: 'bare-invocation-prints-help-and-clean-is-accepted-bare',
      async run({ assert }) {
        // The terminal branch runs whatever the table marks default. #675
        // retired `setup`, so nothing claims the slot and a bare `omega` prints
        // the listing instead of silently running a command.
        assert.equal(table.defaultCommand(), undefined, 'no command claims the default slot');
        assert.equal(
          table.COMMANDS.filter((command) => command.default).length,
          0,
          'no command is marked default',
        );

        const { out, exitCode } = await captured(() => new Main().process(['node', 'script']));
        assert.ok(out.includes('Usage: omega <command>'), 'a bare invocation prints the listing');
        assert.notEqual(exitCode, 1, 'a bare invocation is not an error');

        const clean = table.COMMANDS.find((command) => command.name === 'clean');
        assert.ok(clean, 'bare `clean` is a dispatchable command');
        assert.contains(table.tokensOf(clean), 'clean:npm', '`clean:npm` dispatches the same command');
      },
    },
    {
      name: 'every-dispatchable-token-appears-in-the-help-listing',
      async run({ assert }) {
        const help = table.buildHelpText();

        for (const command of table.COMMANDS) {
          for (const token of table.tokensOf(command)) {
            assert.ok(help.includes(token), `help lists the "${token}" token`);
          }
          for (const arg of Object.keys(command.args || {})) {
            assert.ok(help.includes(arg), `help lists the "${command.name} ${arg}" argument`);
          }
          assert.ok(command.description, `${command.name} carries a description`);
          assert.isType(command.run, 'function', `${command.name} dispatches to something`);
        }
      },
    },
    {
      name: 'help-is-generated-from-the-table-not-hand-written',
      async run({ assert }) {
        // Add a command to the live table: if help were hand-maintained the new
        // command would dispatch invisibly — the exact drift this replaced.
        const probe = { name: 'zzz-probe-command', description: 'probe', run: () => {} };
        table.COMMANDS.push(probe);

        try {
          assert.ok(table.buildHelpText().includes('zzz-probe-command'), 'a new table entry appears in help with no edit to the listing');

          const { out } = await captured(() => new Main().process(['node', 'script', '--help']));
          assert.ok(out.includes('zzz-probe-command'), '`omega help` prints the generated listing');
        } finally {
          table.COMMANDS.splice(table.COMMANDS.indexOf(probe), 1);
        }

        assert.ok(!table.buildHelpText().includes('zzz-probe-command'), 'the probe is gone again');
      },
    },
    {
      name: 'install-resolves-its-mode-aliases-from-the-table',
      async run({ assert }) {
        const install = table.COMMANDS.find((command) => command.name === 'install');

        assert.equal(table.matchCommand(install, { install: true, local: true }), 'local', '`install local`');
        assert.equal(table.matchCommand(install, { i: true, dev: true }), 'local', '`i dev`');
        assert.equal(table.matchCommand(install, { install: true, production: true }), 'live', '`install production`');
        assert.equal(table.matchCommand(install, { live: true }), 'live', 'bare `live`');
        assert.equal(table.matchCommand(install, { install: true }), table.MISSING_ARG, 'a bare `install` is a missing-mode error, not an unknown command');
        assert.equal(table.matchCommand(install, { deploy: true }), false, 'an unrelated command does not match install');
      },
    },
    {
      name: 'bare-install-names-the-real-mode-spellings',
      async run({ assert }) {
        const { err, exitCode } = await captured(() => new Main().process(['node', 'script', 'install']));

        assert.ok(err.includes('omega install local'), 'names the local spelling');
        assert.ok(err.includes('omega install live'), 'names the live spelling');
        assert.equal(exitCode, 1, 'a mode-less install is a failing exit');
      },
    },
  ],
});
