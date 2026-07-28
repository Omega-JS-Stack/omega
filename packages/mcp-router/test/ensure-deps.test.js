/**
 * ensure-deps tests — the self-bootstrap is what lets the plugin's .mcp.json
 * launch the router from a bare marketplace clone with no install step, so
 * both directions matter: silent no-op when dependencies resolve, one npm
 * install in the package root when they do not.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ensureDeps, PKG_ROOT } = require('../src/ensure-deps.js');

test('resolvable dependencies are a silent no-op', () => {
  const ok = ensureDeps({
    spawnSync: () => assert.fail('must not install when dependencies resolve'),
  });
  assert.equal(ok, true);
});

test('unresolvable dependencies trigger one npm install in the package root', () => {
  const calls = [];
  const ok = ensureDeps({
    resolve: () => { throw new Error('Cannot find module'); },
    spawnSync: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args, ['install', '--omit=dev', '--no-fund', '--no-audit']);
  assert.equal(calls[0].options.cwd, PKG_ROOT);
  // stdout stays off the MCP wire.
  assert.equal(calls[0].options.stdio[1], 'ignore');
});

test('a failed install reports false instead of crashing into the SDK import', () => {
  const ok = ensureDeps({
    resolve: () => { throw new Error('Cannot find module'); },
    spawnSync: () => ({ status: 1 }),
  });
  assert.equal(ok, false);
});
