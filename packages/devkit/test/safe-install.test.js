// Unit tests for src/safe-install.js — Socket Firewall wrapper around shell commands.
//
// Real-execution only (no mocks): non-install commands must pass through and run.
// The sfw-prefixing branch is exercised implicitly wherever sfw is installed (e.g.
// Ian's machine) and skipped cleanly where it isn't (CI) — the prefix only applies
// to actual `npm install` commands, which are too heavy for a unit test.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeInstall } = require('../src/safe-install');

test('exports safeInstall as a function', () => {
  assert.equal(typeof safeInstall, 'function');
});

test('non-install commands pass through and execute for real', async () => {
  const output = await safeInstall('node -e "console.log(\'safe-install-ok\')"', { log: false });
  assert.match(String(output), /safe-install-ok/);
});

test('failing commands reject', async () => {
  await assert.rejects(() => safeInstall('node -e "process.exit(3)"', { log: false }));
});
