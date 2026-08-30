// Build-layer tests for cli.js alias resolution. We instantiate Main and call
// process({ _: ['<alias>'] }) — the resolver looks up the alias map and require()s
// the command module. To avoid actually running the command, we stub each command
// to a no-op via require.cache injection before calling process().

const path = require('path');

const CLI_PATH = path.join(__dirname, '..', '..', '..', 'cli.js');
const COMMANDS_DIR = path.join(__dirname, '..', '..', '..', 'commands');

function stubCommand(name, fn) {
  const file = path.join(COMMANDS_DIR, `${name}.js`);
  require.cache[file] = {
    id:       file,
    filename: file,
    loaded:   true,
    children: [],
    paths:    [],
    exports:  fn,
  };
}

function unstub(name) {
  delete require.cache[path.join(COMMANDS_DIR, `${name}.js`)];
}

function freshCli() {
  delete require.cache[CLI_PATH];
  return require(CLI_PATH);
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'cli — alias resolution + dispatch',
  tests: [
    {
      name: 'positional "test" routes to commands/test.js',
      run: async (ctx) => {
        let invoked = false;
        stubCommand('test', async () => { invoked = true; });
        try {
          const Main = freshCli();
          await new Main().process({ _: ['test'] });
          ctx.expect(invoked).toBe(true);
        } finally {
          unstub('test');
        }
      },
    },
    {
      name: 'alias "-t" routes to test command',
      run: async (ctx) => {
        let invoked = false;
        stubCommand('test', async () => { invoked = true; });
        try {
          const Main = freshCli();
          await new Main().process({ _: [], t: true });
          ctx.expect(invoked).toBe(true);
        } finally {
          unstub('test');
        }
      },
    },
    {
      name: 'positional "clean" routes to commands/clean.js',
      run: async (ctx) => {
        let invoked = false;
        stubCommand('clean', async () => { invoked = true; });
        try {
          const Main = freshCli();
          await new Main().process({ _: ['clean'] });
          ctx.expect(invoked).toBe(true);
        } finally {
          unstub('clean');
        }
      },
    },
    {
      name: 'no command prints help and runs nothing (#675 — setup is retired)',
      run: async (ctx) => {
        const Main = freshCli();
        const lines = [];
        const origLog = console.log;
        console.log = (...args) => lines.push(args.join(' '));
        try {
          await new Main().process({ _: [] });
        } finally {
          console.log = origLog;
        }

        ctx.expect(lines.join('\n')).toContain('Usage: omega <command>');
        ctx.expect(lines.join('\n').includes('  setup')).toBe(false);
      },
    },
    {
      name: 'unknown command prints the available listing + exit code 1 (no throw — wave-6 D7)',
      run: async (ctx) => {
        const Main = freshCli();
        const errors = [];
        const origError = console.error;
        const origExitCode = process.exitCode;
        console.error = (...args) => errors.push(args.join(' '));
        try {
          await new Main().process({ _: ['totally-not-a-command-xyz'] });
          ctx.expect(errors.join('\n')).toContain('Unknown command "totally-not-a-command-xyz"');
          ctx.expect(errors.join('\n')).toContain('Available:');
          ctx.expect(process.exitCode).toBe(1);
        } finally {
          console.error = origError;
          process.exitCode = origExitCode;
        }
      },
    },
    {
      name: 'command options are forwarded',
      run: async (ctx) => {
        let received = null;
        stubCommand('test', async (opts) => { received = opts; });
        try {
          const Main = freshCli();
          await new Main().process({ _: ['test'], layer: 'build', filter: 'foo' });
          ctx.expect(received.layer).toBe('build');
          ctx.expect(received.filter).toBe('foo');
        } finally {
          unstub('test');
        }
      },
    },
    {
      name: 'cli-run disables yargs built-in --help/--version (router owns both)',
      run: (ctx) => {
        // The built-ins printed an empty stub and version "0.0.0" instead of
        // reaching the alias table / the router's generated help (wave-6 D1).
        const source = require('fs').readFileSync(path.join(__dirname, '..', '..', '..', 'cli-run.js'), 'utf8');
        ctx.expect(source.includes('.version(false)')).toBeTruthy();
        ctx.expect(source.includes('.help(false)')).toBeTruthy();
      },
    },
    {
      name: 'mirrored aliases: -t routes to test, -d routes to deploy (wave-6 D6)',
      run: (ctx) => {
        const { aliases } = freshCli().config;
        ctx.expect(aliases.test.includes('-t')).toBe(true);
        ctx.expect(aliases.deploy.includes('-d')).toBe(true);
      },
    },
  ],
};
