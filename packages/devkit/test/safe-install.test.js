// Unit tests for src/safe-install.js — Socket Firewall wrapper around shell commands.
//
// Real-execution only (no mocks): non-install commands must pass through and run.
// The sfw-prefixing branch is exercised implicitly wherever sfw is installed (e.g.
// Ian's machine) and skipped cleanly where it isn't (CI) — the prefix only applies
// to actual `npm install` commands, which are too heavy for a unit test.

const defineCases = require('@omega.js/devkit/test/define-cases');
const { safeInstall } = require('../src/safe-install');

module.exports = defineCases({
  type: 'group',
  description: 'safe-install',
  tests: [
    {
      name: 'exports safeInstall as a function',
      run: (ctx) => {
        ctx.expect(typeof safeInstall).toBe('function');
      },
    },

    {
      name: 'non-install commands pass through and execute for real',
      run: async (ctx) => {
        const output = await safeInstall('node -e "console.log(\'safe-install-ok\')"', { log: false });
        ctx.expect(String(output)).toMatch(/safe-install-ok/);
      },
    },

    {
      name: 'failing commands reject',
      run: async (ctx) => {
        await ctx.expect((() => safeInstall('node -e "process.exit(3)"', { log: false }))()).rejects.toThrow();
      },
    },
  ],
});
