/**
 * CLI dispatch pins — the tail of Main.process()'s if-chain. The old chain had
 * no terminal branch: bare `omega` and any unknown command returned undefined
 * and exited 0 in silence. Pins: help never falls through to a command, the
 * unknown path names the command and sets a failing exit code, bare invocation
 * defaults to setup (mirroring the router frameworks), and `clean` is accepted
 * bare alongside `clean:npm`.
 */

const fs = require('fs');
const path = require('path');

const Main = require('../../dist/cli/index.js');

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

module.exports = {
  description: 'CLI dispatch — help, unknown-command, and default-verb behavior',
  type: 'group',

  tests: [
    {
      name: 'help-prints-the-command-listing-and-runs-nothing',
      async run({ assert }) {
        const { out, exitCode } = await captured(() => new Main().process(['node', 'script', '--help']));
        assert.ok(out.includes('Usage: omega <command>'), 'help prints the usage banner');
        assert.ok(out.includes('setup'), 'help lists the setup command');
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
      name: 'dispatcher-source-pins-bare-default-and-clean-alias',
      async run({ assert }) {
        const source = fs.readFileSync(path.join(__dirname, '../../dist/cli/index.js'), 'utf8');
        assert.ok(source.includes('commandArgs.length === 0'), 'bare invocation has a terminal branch');
        assert.ok(/commandArgs\.length === 0[\s\S]{0,120}new SetupCommand/.test(source), 'bare invocation defaults to setup');
        assert.ok(source.includes("options['clean:npm'] || self.options.clean"), 'bare `clean` dispatches the clean command');
      },
    },
  ],
};
