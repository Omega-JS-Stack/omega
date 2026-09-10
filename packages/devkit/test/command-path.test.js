// Unit tests for src/command-path.js — the one cross-platform PATH probe
// (`which` on Unix, `where` on Windows) every framework asks before shelling
// out to mkcert / nodemon / the Stripe CLI.
//
// The platform and the exec are both injected, so the Windows branch is pinned
// on a Mac: `where` does not exist here, and running the branch for real would
// only ever prove the not-found answer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('exports the expected surface', () => {
  assert.equal(typeof commandOnPath, 'function');
});

test('unix probes with `which`', () => {
  const { exec, calls } = recordingExec('/opt/homebrew/bin/mkcert\n');

  assert.equal(commandOnPath('mkcert', { platform: 'darwin', exec }), '/opt/homebrew/bin/mkcert');
  assert.deepEqual(calls, ['which mkcert']);
});

test('linux probes with `which` too', () => {
  const { exec, calls } = recordingExec('/usr/bin/mkcert\n');

  assert.equal(commandOnPath('mkcert', { platform: 'linux', exec }), '/usr/bin/mkcert');
  assert.deepEqual(calls, ['which mkcert']);
});

test('win32 probes with `where` — Windows has no `which`', () => {
  const { exec, calls } = recordingExec('C:\\ProgramData\\chocolatey\\bin\\mkcert.exe\r\n');

  assert.equal(commandOnPath('mkcert', { platform: 'win32', exec }), 'C:\\ProgramData\\chocolatey\\bin\\mkcert.exe');
  assert.deepEqual(calls, ['where mkcert']);
});

test('`where` prints every match; the first one is the answer', () => {
  // The REAL `where nodemon` order for an npm global: the extensionless shell
  // shim first, then the .cmd, then the .ps1. The first line is the answer —
  // and it is also why nothing spawns this path: that shim is not executable by
  // CreateProcess, so callers name `nodemon` bare and let the shell resolve it.
  const { exec } = recordingExec('C:\\npm\\nodemon\r\nC:\\npm\\nodemon.cmd\r\nC:\\npm\\nodemon.ps1\r\n');

  assert.equal(commandOnPath('nodemon', { platform: 'win32', exec }), 'C:\\npm\\nodemon');
});

test('a nonzero probe (not installed) answers null, not a throw', () => {
  const exec = () => {
    throw Object.assign(new Error('Command failed: which mkcert'), { status: 1 });
  };

  assert.equal(commandOnPath('mkcert', { platform: 'darwin', exec }), null);
  assert.equal(commandOnPath('mkcert', { platform: 'win32', exec }), null);
});

test('an empty answer is null, never an empty string', () => {
  const { exec } = recordingExec('\n');

  assert.equal(commandOnPath('mkcert', { platform: 'darwin', exec }), null);
});

test('against the real PATH: node resolves, a nonsense name does not', () => {
  const found = commandOnPath('node');

  assert.ok(found, 'node is on PATH for this very process');
  assert.ok(path.isAbsolute(found), `expected an absolute path, got ${found}`);
  assert.equal(commandOnPath('omega-no-such-command-9f3c'), null);
});
