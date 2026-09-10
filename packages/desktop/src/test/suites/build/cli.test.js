// CLI structure tests — every alias has a command file, every command file is a function, bin is executable.

const path = require('path');
const fs = require('fs');

const Manager = require('../../../build.js');
const defineCases = require('@omega.js/devkit/test/define-cases');
const root = Manager.getRootPath('main');

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'CLI',
  tests: [
    {
      name: 'every alias has a corresponding command file',
      run: (ctx) => {
        // The devkit router exposes its resolved dispatch table as Main.config —
        // introspect it instead of scraping the cli.js source.
        const Main = require(path.join(root, 'dist', 'cli.js'));
        const { commandsDir, aliases, defaultCommand } = Main.config;

        // The default command is the router's BUILT-IN help since setup was
        // retired (#675) — it dispatches without a command file.
        ctx.expect(defaultCommand).toBe('help');

        const commands = Object.keys(aliases);
        ctx.expect(commands.length).toBeGreaterThan(0);

        for (const cmd of commands) {
          const file = path.join(commandsDir, `${cmd}.js`);
          if (!fs.existsSync(file)) {
            throw new Error(`Command "${cmd}" registered in the alias table but no ${file} exists.`);
          }
        }
      },
    },
    {
      name: 'every command file exports a function',
      run: (ctx) => {
        const cmdDir = path.join(root, 'dist', 'commands');
        const files = fs.readdirSync(cmdDir).filter((f) => f.endsWith('.js'));
        ctx.expect(files.length).toBeGreaterThan(0);

        for (const file of files) {
          const fn = require(path.join(cmdDir, file));
          if (typeof fn !== 'function') {
            throw new Error(`commands/${file} does not export a function`);
          }
        }
      },
    },
    {
      name: 'bin/omega-desktop exists',
      run: (ctx) => {
        const binFile = path.join(root, 'bin', 'omega-desktop');
        ctx.expect(fs.existsSync(binFile)).toBeTruthy();
      },
    },
    {
      name: 'bin/omega-desktop is executable',
      run: (ctx) => {
        // NTFS has no execute bit, so the mode carries nothing to assert on a
        // Windows checkout — the existence case above still runs everywhere.
        if (process.platform === 'win32') ctx.skip('NTFS has no execute bit — `stat.mode & 0o100` is meaningless on Windows');
        const stat = fs.statSync(path.join(root, 'bin', 'omega-desktop'));
        ctx.expect((stat.mode & 0o100) !== 0).toBeTruthy();
      },
    },
    {
      name: 'cli-run disables yargs built-in --help/--version (router owns both)',
      run: (ctx) => {
        // The built-ins printed an empty stub and version "0.0.0" instead of
        // reaching the alias table / the router's generated help (wave-6 D1).
        const source = fs.readFileSync(path.join(root, 'dist', 'cli-run.js'), 'utf8');
        ctx.expect(source.includes('.version(false)')).toBeTruthy();
        ctx.expect(source.includes('.help(false)')).toBeTruthy();
      },
    },
    {
      name: 'the box verbs never read the project .env cascade (#337)',
      run: (ctx) => {
        // A signing box is a MACHINE: `runner` and `sign-windows` read the shell
        // and <runner home>\.env, nothing else. Run from a brand folder, the
        // project's GH_TOKEN would otherwise register the box's runners against
        // that token's orgs. Every other verb keeps the cascade.
        const os = require('os');
        const { spawnSync } = require('child_process');

        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-cli-env-'));
        try {
          fs.writeFileSync(path.join(projectDir, '.env'), 'GH_TOKEN="ghp_from_the_project"\n');
          const script = path.join(projectDir, 'boot.js');
          fs.writeFileSync(script, [
            `require(${JSON.stringify(path.join(root, 'dist', 'cli.js'))});`,
            'process.stdout.write(String(process.env.GH_TOKEN || \'(unset)\'));',
          ].join('\n'));

          // The child gets no token to find, and no real box home to read one
          // from: `runner`/`sign-windows` read `<runner home>/.env` at require
          // time, and this case must never touch the signing box's own file.
          const env = { ...process.env, OMEGA_RUNNER_HOME: path.join(projectDir, '.runner-home') };
          delete env.GH_TOKEN;
          const boot = (...argv) => spawnSync(process.execPath, [script, ...argv], { cwd: projectDir, env, encoding: 'utf8' });

          const built = boot('build');
          ctx.expect(built.status).toBe(0);
          ctx.expect(built.stdout).toBe('ghp_from_the_project');

          // Both spellings the alias table takes: the bare verb and its `--` flag.
          for (const argv of [
            ['runner', 'status'], ['sign-windows', '--smoke'],
            ['--runner'], ['--runner', 'status'], ['--sign-windows', '--smoke'],
          ]) {
            const boxed = boot(...argv);
            ctx.expect(boxed.status).toBe(0);
            if (boxed.stdout !== '(unset)') {
              throw new Error(`\`omega ${argv.join(' ')}\` applied the project .env (GH_TOKEN=${boxed.stdout}) — the box reads only the shell and its own file.`);
            }
          }
        } finally {
          fs.rmSync(projectDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'mirrored aliases: -t routes to test, -d routes to deploy (wave-6 D6)',
      run: (ctx) => {
        const { aliases } = require(path.join(root, 'dist', 'cli.js')).config;
        ctx.expect(aliases.test.includes('-t')).toBe(true);
        ctx.expect(aliases.deploy.includes('-d')).toBe(true);
      },
    },
  ],
});
