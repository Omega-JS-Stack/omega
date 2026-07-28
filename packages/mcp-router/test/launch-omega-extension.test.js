/**
 * launch-omega-extension tests — the upstream is only as portable as this
 * resolution, and its two failure modes (manager absent, manager present but
 * without the extension server on disk) must name what was expected.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveManagerRoot, resolveServerPath, main } = require('../src/launch-omega-extension.js');

/**
 * Capture everything written to stderr while running a function.
 *
 * @param {Function} run - The body to run
 * @returns {string} What was written
 */
function captureStderr(run) {
  const chunks = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    run();
  } finally {
    process.stderr.write = write;
  }
  return chunks.join('');
}

test('the manager root is the main export two dirnames up', () => {
  assert.equal(resolveManagerRoot({ resolve: () => '/somewhere/node_modules/@omega.js/manager/dist/index.js' }), '/somewhere/node_modules/@omega.js/manager');
});

test('the server path is the extension MCP entry inside that root', () => {
  const resolved = resolveServerPath({
    resolve: () => '/pkgs/manager/dist/index.js',
    exists: (file) => file === path.join('/pkgs/manager', 'extension', 'mcp-server', 'index.js'),
  });
  assert.deepEqual(resolved, { server: path.join('/pkgs/manager', 'extension', 'mcp-server', 'index.js') });
});

test('this monorepo resolves a real extension MCP server on disk', () => {
  const resolved = resolveServerPath();
  assert.equal(resolved.error, undefined, resolved.error);
  assert.match(resolved.server, /manager[/\\]extension[/\\]mcp-server[/\\]index\.js$/);
});

test('an unresolvable manager falls back to the monorepo sibling package', () => {
  const seen = [];
  const root = resolveManagerRoot({
    resolve: () => { throw new Error('Cannot find module'); },
    exists: (file) => { seen.push(file); return true; },
  });
  assert.match(root, /packages[/\\]manager$/);
  assert.deepEqual(seen, [path.join(root, 'package.json')]);
});

test('an uninstalled manager with no sibling fails loudly, naming the package', () => {
  const resolved = resolveServerPath({
    resolve: () => { throw new Error('Cannot find module'); },
    exists: () => false,
  });
  assert.match(resolved.error, /@omega\.js\/manager is not installed/);
});

test('an installed manager missing the extension server fails loudly, naming the file', () => {
  const resolved = resolveServerPath({ resolve: () => '/pkgs/manager/dist/index.js', exists: () => false });
  assert.match(resolved.error, /extension[/\\]mcp-server[/\\]index\.js is missing/);
});

test('main runs the resolved server on this node and forwards its exit code', () => {
  const calls = [];
  const exits = [];
  main({
    resolve: () => '/pkgs/manager/dist/index.js',
    exists: () => true,
    execPath: '/usr/bin/node',
    exit: (code) => exits.push(code),
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { on: (event, handler) => { if (event === 'exit') handler(0, null); } };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/usr/bin/node');
  assert.deepEqual(calls[0].args, [path.join('/pkgs/manager', 'extension', 'mcp-server', 'index.js')]);
  assert.equal(calls[0].options.stdio, 'inherit');
  // The server's imports (the MCP SDK, ws) resolve through this package's
  // node_modules when the manager tree has none of its own.
  assert.ok(calls[0].options.env.NODE_PATH.split(path.delimiter)
    .some((entry) => /mcp-router[/\\]node_modules$/.test(entry)));
  assert.deepEqual(exits, [0]);
});

test('a missing server exits 1 without spawning', () => {
  const exits = [];
  const said = captureStderr(() => {
    main({
      resolve: () => '/pkgs/manager/dist/index.js',
      exists: () => false,
      exit: (code) => exits.push(code),
      spawn: () => assert.fail('must not spawn when the server is missing'),
    });
  });
  assert.deepEqual(exits, [1]);
  assert.match(said, /mcp-server/);
});
