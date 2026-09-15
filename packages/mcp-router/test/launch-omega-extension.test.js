/**
 * launch-omega-extension tests. The upstream is only as portable as this
 * resolution, and since [#927](https://github.com/Omega-JS-Stack/omega/issues/927)
 * there is only one thing to resolve: the server file this package ships
 * beside the launcher. It used to be hunted down inside an installed
 * `@omega.js/manager`, which never publishes the tree it lived in.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SERVER, resolveServerPath, main } = require('../src/launch-omega-extension.js');

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

test('the server is the file this package ships beside the launcher', () => {
  const resolved = resolveServerPath();
  assert.equal(resolved.error, undefined, resolved.error);
  assert.equal(resolved.server, SERVER);
  assert.match(resolved.server, /mcp-router[/\\]servers[/\\]omega-extension[/\\]index\.js$/);
  assert.equal(fs.existsSync(resolved.server), true, 'the shipped server is not on disk');
});

test('the shipped server imports nothing but this package own dependencies', () => {
  // The whole point of the move: the upstream starts with no manager, no brand
  // and no NODE_PATH, so every bare import must resolve from the server itself.
  const source = fs.readFileSync(SERVER, 'utf8');
  const bare = [...source.matchAll(/require\('([^.][^']*)'\)/g)].map((match) => match[1]);
  assert.ok(bare.length > 0, 'no imports found: the scan is broken, not the server');
  for (const request of bare) {
    assert.doesNotThrow(() => require.resolve(request, { paths: [path.dirname(SERVER)] }), `${request} does not resolve for the shipped server`);
  }
});

test('a broken install fails loudly, naming the file this package ships', () => {
  const resolved = resolveServerPath({ exists: () => false });
  assert.match(resolved.error, /servers[/\\]omega-extension[/\\]index\.js is missing/);
  assert.match(resolved.error, /@omega\.js\/mcp-router ships/);
});

test('main runs the shipped server on this node and forwards its exit code', () => {
  const calls = [];
  const exits = [];
  main({
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
  assert.deepEqual(calls[0].args, [SERVER]);
  assert.equal(calls[0].options.stdio, 'inherit');
  // No env override at all: a NODE_PATH used to carry this package's
  // node_modules to a server that sat in someone else's tree.
  assert.equal(calls[0].options.env, undefined);
  assert.deepEqual(exits, [0]);
});

test('a missing server exits 1 without spawning', () => {
  const exits = [];
  const said = captureStderr(() => {
    main({
      exists: () => false,
      exit: (code) => exits.push(code),
      spawn: () => assert.fail('must not spawn when the server is missing'),
    });
  });
  assert.deepEqual(exits, [1]);
  assert.match(said, /omega-extension/);
});
