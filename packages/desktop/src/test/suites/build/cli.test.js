// CLI structure tests — every alias has a command file, every command file is a function, bin is executable.

const path = require('path');
const fs = require('fs');

const Manager = require('../../../build.js');
const root = Manager.getRootPath('main');

module.exports = {
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

        const commands = [...new Set([...Object.keys(aliases), defaultCommand])];
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
      name: 'bin/omega-desktop exists and is executable',
      run: (ctx) => {
        const binFile = path.join(root, 'bin', 'omega-desktop');
        ctx.expect(fs.existsSync(binFile)).toBeTruthy();
        const stat = fs.statSync(binFile);
        ctx.expect((stat.mode & 0o100) !== 0).toBeTruthy();
      },
    },
  ],
};
