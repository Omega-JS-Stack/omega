// Unit tests for src/command-path.js — the one cross-platform PATH probe
// (`which` on Unix, `where` on Windows) every framework asks before shelling
// out to mkcert / nodemon / the Stripe CLI.
//
// The platform and the exec are both injected, so the Windows branch is pinned
// on a Mac: `where` does not exist here, and running the branch for real would
// only ever prove the not-found answer.

const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('node:path');
const { commandOnPath } = require('../src/command-path.js');

/** An execSync stand-in that records its command and answers a fixed string. */
function recordingExec(output) {
  const calls = [];
  const exec = (command) => {
    calls.push(command);
    return output;
  };
  return { exec, calls };
}

module.exports = defineCases({
  type: 'group',
  description: 'command-path',
  tests: [
    {
      name: 'exports the expected surface',
      run: (ctx) => {
        ctx.expect(typeof commandOnPath).toBe('function');
      },
    },

    {
      name: 'unix probes with `which`',
      run: (ctx) => {
        const { exec, calls } = recordingExec('/opt/homebrew/bin/mkcert\n');

        ctx.expect(commandOnPath('mkcert', { platform: 'darwin', exec })).toBe('/opt/homebrew/bin/mkcert');
        ctx.expect(calls).toEqual(['which mkcert']);
      },
    },

    {
      name: 'linux probes with `which` too',
      run: (ctx) => {
        const { exec, calls } = recordingExec('/usr/bin/mkcert\n');

        ctx.expect(commandOnPath('mkcert', { platform: 'linux', exec })).toBe('/usr/bin/mkcert');
        ctx.expect(calls).toEqual(['which mkcert']);
      },
    },

    {
      name: 'win32 probes with `where` — Windows has no `which`',
      run: (ctx) => {
        const { exec, calls } = recordingExec('C:\\ProgramData\\chocolatey\\bin\\mkcert.exe\r\n');

        ctx.expect(commandOnPath('mkcert', { platform: 'win32', exec })).toBe('C:\\ProgramData\\chocolatey\\bin\\mkcert.exe');
        ctx.expect(calls).toEqual(['where mkcert']);
      },
    },

    {
      name: '`where` prints every match; the first one is the answer',
      run: (ctx) => {
        // The REAL `where nodemon` order for an npm global: the extensionless shell
        // shim first, then the .cmd, then the .ps1. The first line is the answer —
        // and it is also why nothing spawns this path: that shim is not executable by
        // CreateProcess, so callers name `nodemon` bare and let the shell resolve it.
        const { exec } = recordingExec('C:\\npm\\nodemon\r\nC:\\npm\\nodemon.cmd\r\nC:\\npm\\nodemon.ps1\r\n');

        ctx.expect(commandOnPath('nodemon', { platform: 'win32', exec })).toBe('C:\\npm\\nodemon');
      },
    },

    {
      name: 'a nonzero probe (not installed) answers null, not a throw',
      run: (ctx) => {
        const exec = () => {
          throw Object.assign(new Error('Command failed: which mkcert'), { status: 1 });
        };

        ctx.expect(commandOnPath('mkcert', { platform: 'darwin', exec })).toBe(null);
        ctx.expect(commandOnPath('mkcert', { platform: 'win32', exec })).toBe(null);
      },
    },

    {
      name: 'an empty answer is null, never an empty string',
      run: (ctx) => {
        const { exec } = recordingExec('\n');

        ctx.expect(commandOnPath('mkcert', { platform: 'darwin', exec })).toBe(null);
      },
    },

    {
      name: 'against the real PATH: node resolves, a nonsense name does not',
      run: (ctx) => {
        const found = commandOnPath('node');

        ctx.expect(found, 'node is on PATH for this very process').toBeTruthy();
        ctx.expect(path.isAbsolute(found), `expected an absolute path, got ${found}`).toBeTruthy();
        ctx.expect(commandOnPath('omega-no-such-command-9f3c')).toBe(null);
      },
    },
  ],
});
