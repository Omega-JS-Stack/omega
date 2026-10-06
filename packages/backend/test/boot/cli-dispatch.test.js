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
      async run({ expect }) {
        const { out, exitCode } = await captured(() => new Main().process(['node', 'script', '--help']));
        expect(out.includes('Usage: omega <command>'), 'help prints the usage banner').toBeTruthy();
        expect(!out.includes('setup'), 'help does not list the retired setup command').toBeTruthy();
        expect(exitCode, 'help is not an error').not.toBe(1);
      },
    },
    {
      name: 'unknown-command-prints-listing-and-sets-exit-code-1',
      async run({ expect }) {
        const { err, exitCode } = await captured(() => new Main().process(['node', 'script', 'dpeloy']));
        expect(err.includes('Unknown command "dpeloy"'), 'names the unknown command').toBeTruthy();
        expect(err.includes('Usage: omega <command>'), 'prints the command listing').toBeTruthy();
        expect(exitCode, 'unknown command is a failing exit').toBe(1);
      },
    },
    {
      name: 'bare-invocation-prints-help-and-clean-is-accepted-bare',
      async run({ expect }) {
        // The terminal branch runs whatever the table marks default. #675
        // retired `setup`, so nothing claims the slot and a bare `omega` prints
        // the listing instead of silently running a command.
        expect(table.defaultCommand(), 'no command claims the default slot').toBe(undefined);
        expect(table.COMMANDS.filter((command) => command.default).length, 'no command is marked default').toBe(0);

        const { out, exitCode } = await captured(() => new Main().process(['node', 'script']));
        expect(out.includes('Usage: omega <command>'), 'a bare invocation prints the listing').toBeTruthy();
        expect(exitCode, 'a bare invocation is not an error').not.toBe(1);

        const clean = table.COMMANDS.find((command) => command.name === 'clean');
        expect(clean, 'bare `clean` is a dispatchable command').toBeTruthy();
        expect(table.tokensOf(clean), '`clean:npm` dispatches the same command').toContain('clean:npm');
      },
    },
    {
      name: 'every-dispatchable-token-appears-in-the-help-listing',
      async run({ expect }) {
        const help = table.buildHelpText();

        for (const command of table.COMMANDS) {
          for (const token of table.tokensOf(command)) {
            expect(help.includes(token), `help lists the "${token}" token`).toBeTruthy();
          }
          for (const arg of Object.keys(command.args || {})) {
            expect(help.includes(arg), `help lists the "${command.name} ${arg}" argument`).toBeTruthy();
          }
          expect(command.description, `${command.name} carries a description`).toBeTruthy();
          expect(command.run, `${command.name} dispatches to something`).toBeTypeOf('function');
        }
      },
    },
    {
      name: 'help-is-generated-from-the-table-not-hand-written',
      async run({ expect }) {
        // Add a command to the live table: if help were hand-maintained the new
        // command would dispatch invisibly — the exact drift this replaced.
        const probe = { name: 'zzz-probe-command', description: 'probe', run: () => {} };
        table.COMMANDS.push(probe);

        try {
          expect(table.buildHelpText().includes('zzz-probe-command'), 'a new table entry appears in help with no edit to the listing').toBeTruthy();

          const { out } = await captured(() => new Main().process(['node', 'script', '--help']));
          expect(out.includes('zzz-probe-command'), '`omega help` prints the generated listing').toBeTruthy();
        } finally {
          table.COMMANDS.splice(table.COMMANDS.indexOf(probe), 1);
        }

        expect(!table.buildHelpText().includes('zzz-probe-command'), 'the probe is gone again').toBeTruthy();
      },
    },
  ],
});
