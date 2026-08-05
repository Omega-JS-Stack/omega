/**
 * ensure-deps tests — the self-bootstrap is what lets the plugin's .mcp.json
 * launch the router from a bare marketplace clone with no install step, so
 * both directions matter: silent no-op when dependencies resolve, one npm
 * install in the package root when they do not.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const { ensureDeps, PKG_ROOT } = require('../src/ensure-deps.js');
const { resolveBin } = require('../src/lib/env.js');

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
  // Quotes only on win32, where the spawn goes through a shell to run npm.cmd.
  assert.equal(calls[0].command.replace(/"/g, ''), resolveBin('npm'));
  assert.deepEqual(calls[0].args, ['install', '--omit=dev', '--no-fund', '--no-audit']);
  assert.equal(calls[0].options.cwd, PKG_ROOT);
  // stdout stays off the MCP wire.
  assert.equal(calls[0].options.stdio[1], 'ignore');
});

test('the npm spawn is the binary beside this node, not a bare PATH lookup', () => {
  const sibling = ['npm.cmd', 'npm']
    .map((name) => path.join(path.dirname(process.execPath), name))
    .find((candidate) => fs.existsSync(candidate));
  if (!sibling) return; // No sibling npm here — PATH is the correct fallback.

  const calls = [];
  ensureDeps({
    resolve: () => { throw new Error('Cannot find module'); },
    spawnSync: (command) => { calls.push(command); return { status: 0 }; },
  });
  assert.equal(path.isAbsolute(calls[0].replace(/"/g, '')), true, `expected an absolute npm, got ${calls[0]}`);
});

test('the require chain stays builtin-only — this runs before node_modules exists', () => {
  const original = Module._resolveFilename;
  const requested = [];
  Module._resolveFilename = function (request, ...rest) {
    const resolved = original.call(this, request, ...rest);
    if (resolved.includes('node_modules')) requested.push(request);
    return resolved;
  };
  const srcDir = path.join(PKG_ROOT, 'src') + path.sep;
  try {
    // Drop the whole src tree so every file's top-level requires run again —
    // a cached child would hide its own imports from the probe.
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(srcDir)) delete require.cache[key];
    }
    require('../src/ensure-deps.js');
  } finally {
    Module._resolveFilename = original;
  }
  assert.deepEqual(requested, [], 'ensure-deps pulled a non-builtin module');
});

test('a failed install reports false instead of crashing into the SDK import', () => {
  const ok = ensureDeps({
    resolve: () => { throw new Error('Cannot find module'); },
    spawnSync: () => ({ status: 1 }),
  });
  assert.equal(ok, false);
});
