// Unit tests for src/cli-router.js — the shared framework CLI dispatcher.
//
// Fixture command modules live in test/fixtures/cli-commands/; each records its
// run by mutating the options object the test passes in (no globals), matching
// the real command contract: module.exports = async (options) => {}.

const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const { createCliRouter } = require('../src/cli-router');

const COMMANDS_DIR = path.join(__dirname, 'fixtures', 'cli-commands');

const ALIASES = {
  install: ['-i', 'i', '--install'],
  setup: ['-s', '--setup'],
  version: ['-v', '--version'],
};

function makeMain(overrides) {
  const Main = createCliRouter({
    commandsDir: COMMANDS_DIR,
    aliases: ALIASES,
    ...overrides,
  });
  return new Main();
}

// Capture console output + exit code around a process() call, restoring after.
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
  type: 'group',
  description: 'cli-router',
  tests: [
    {
      name: 'exports createCliRouter as a function',
      run: (ctx) => {
        ctx.expect(typeof createCliRouter).toBe('function');
      },
    },

    {
      name: 'throws without commandsDir',
      run: (ctx) => {
        ctx.expect(() => createCliRouter({})).toThrow(/commandsDir is required/);
      },
    },

    {
      name: 'exposes the resolved dispatch table as Main.config',
      run: (ctx) => {
        const Main = createCliRouter({ commandsDir: COMMANDS_DIR, aliases: ALIASES });
        ctx.expect(Main.config.commandsDir).toBe(COMMANDS_DIR);
        ctx.expect(Main.config.aliases).toEqual(ALIASES);
        ctx.expect(Main.config.defaultCommand, 'the OMEGA default is help — setup is retired (#675)').toBe('help');
      },
    },

    {
      name: 'positional command name runs the matching module',
      run: async (ctx) => {
        const options = { _: ['version'] };
        await makeMain().process(options);
        ctx.expect(options.__ran).toBe('version');
      },
    },

    {
      name: 'positional alias resolves to its command',
      run: async (ctx) => {
        const options = { _: ['i'] };
        await makeMain().process(options);
        ctx.expect(options.__ran).toBe('install');
      },
    },

    {
      name: 'flag-style alias resolves to its command',
      run: async (ctx) => {
        const options = { _: [], v: true };
        await makeMain().process(options);
        ctx.expect(options.__ran).toBe('version');
      },
    },

    {
      name: 'no positional or flag falls back to the default command (help)',
      run: async (ctx) => {
        // #675 retired `setup`, so the OMEGA default is help: a bare `omega` prints
        // the listing instead of silently running a command.
        const options = { _: [] };
        const { out } = await captured(() => makeMain().process(options));
        ctx.expect(options.__ran, 'a bare invocation runs no command').toBe(undefined);
        ctx.expect(out).toMatch(/Usage: omega <command>/);
      },
    },

    {
      name: 'defaultCommand override is honored',
      run: async (ctx) => {
        const options = { _: [] };
        await makeMain({ defaultCommand: 'version' }).process(options);
        ctx.expect(options.__ran).toBe('version');
      },
    },

    {
      name: 'unknown positional prints the available-command listing and sets exit code 1 (no throw)',
      run: async (ctx) => {
        const { err, exitCode } = await captured(() => makeMain().process({ _: ['nope'] }));
        ctx.expect(err).toMatch(/Unknown command "nope"/);
        ctx.expect(err).toMatch(/Available: boom, install, refuse, setup, version/);
        ctx.expect(exitCode).toBe(1);
      },
    },

    {
      name: 'a fallback handler runs a command that has no file, and a null one leaves the unknown answer',
      run: async (ctx) => {
        const asked = [];
        const main = makeMain({
          fallback: (command) => {
            asked.push(command);
            return command === 'passed' ? async (options) => { options.__ran = 'fallback'; } : null;
          },
        });

        const options = { _: ['passed'] };
        await main.process(options);
        ctx.expect(options.__ran).toBe('fallback');

        const { err, exitCode } = await captured(() => main.process({ _: ['nope'] }));
        ctx.expect(err).toMatch(/Unknown command "nope"/);
        ctx.expect(exitCode).toBe(1);

        await main.process({ _: ['version'] });
        ctx.expect(asked, 'a command with a file never asks the fallback').toEqual(['passed', 'nope']);
      },
    },

    {
      name: 'command errors surface once (own stack, exit code 1) with no wrapper prefix or rethrow',
      run: async (ctx) => {
        const { err, exitCode } = await captured(() => makeMain().process({ _: ['boom'] }));
        ctx.expect(err).toMatch(/kaboom/);
        // The other half of #706's rule: a BUG still prints its stack. The refusal
        // twin below asserts the absence, so this one asserts the presence — together
        // they pin the branch, which a message-only print would otherwise satisfy.
        ctx.expect(err, 'a genuine error keeps its stack frames').toMatch(/\n\s+at /);
        ctx.expect(err).not.toMatch(/Error executing command/);
        ctx.expect(exitCode).toBe(1);
      },
    },

    {
      name: 'a crafted refusal prints its message alone — no stack under it (#706)',
      run: async (ctx) => {
        // A refused command renders the SAME way on every surface: the crafted lines,
        // nothing added. The stack belongs to a bug, and a refusal is not one.
        const { err, exitCode } = await captured(() => makeMain().process({ _: ['refuse'] }));
        ctx.expect(err).toMatch(/refusing to scaffold into/);
        ctx.expect(err, 'a refusal never prints a stack frame').not.toMatch(/at Object/);
        ctx.expect(err, 'nor the Error: prefix a stack carries').not.toMatch(/^Error: /m);
        ctx.expect(exitCode).toBe(1);
      },
    },

    {
      name: '--help routes to the built-in help, never the default command',
      run: async (ctx) => {
        const options = { _: [], help: true };
        const { out } = await captured(() => makeMain().process(options));
        ctx.expect(options.__ran).toBe(undefined);
        ctx.expect(out).toMatch(/Usage: omega <command>/);
        ctx.expect(out).toMatch(/install \(-i, i, --install\)/);
        ctx.expect(out).toMatch(/setup \(-s, --setup\)/);
      },
    },

    {
      name: '--help beats a positional command — `omega deploy --help` must never RUN deploy',
      run: async (ctx) => {
        const options = { _: ['install'], help: true };
        const { out } = await captured(() => makeMain().process(options));
        ctx.expect(options.__ran).toBe(undefined);
        ctx.expect(out).toMatch(/Usage: omega <command>/);
      },
    },

    {
      name: 'positional "help" and -h reach the same built-in help',
      run: async (ctx) => {
        const positional = await captured(() => makeMain().process({ _: ['help'] }));
        ctx.expect(positional.out).toMatch(/Usage: omega <command>/);
        const shortFlag = await captured(() => makeMain().process({ _: [], h: true }));
        ctx.expect(shortFlag.out).toMatch(/Usage: omega <command>/);
      },
    },
  ],
});
