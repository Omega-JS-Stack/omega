/**
 * CLI tests — every command runs against fixture layer dirs, and the standing
 * assertion under all of them is the same one: the bundled dir is never
 * written. `refresh` spawns the real fixture MCP server, so the cached
 * schema it writes came off a genuine stdio handshake.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../src/cli.js');

const ECHO_SERVER = path.join(__dirname, 'fixtures', 'echo-server.js');

const BUNDLED = {
  // Commands point at scripts that do not exist — a refresh must fail fast and
  // locally, never resolve a name through the public npm registry.
  alpha: { enabled: true, command: 'node', args: [path.join(__dirname, 'fixtures', 'no-such-server.js')], tools: [{ name: 'go' }] },
  beta: { enabled: false, command: 'node', args: [path.join(__dirname, 'fixtures', 'no-such-server-either.js')], tools: [] },
};

/**
 * Fixture layers plus captured output.
 *
 * @returns {object} `{ bundledDir, overlayDir, out, err, lines, errors }`
 */
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-cli-'));
  const bundledDir = path.join(root, 'bundled');
  const overlayDir = path.join(root, 'overlay');
  for (const [name, config] of Object.entries(BUNDLED)) {
    fs.mkdirSync(path.join(bundledDir, name), { recursive: true });
    fs.writeFileSync(path.join(bundledDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  fs.mkdirSync(overlayDir, { recursive: true });

  const lines = [];
  const errors = [];
  return { bundledDir, overlayDir, lines, errors, out: (line) => lines.push(line), err: (line) => errors.push(line) };
}

const overlayOf = (context, name) => JSON.parse(fs.readFileSync(path.join(context.overlayDir, name, 'config.json'), 'utf8'));
const writeOverlay = (context, name, config) => {
  fs.mkdirSync(path.join(context.overlayDir, name), { recursive: true });
  fs.writeFileSync(path.join(context.overlayDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
};
const bundledOf = (context, name) => JSON.parse(fs.readFileSync(path.join(context.bundledDir, name, 'config.json'), 'utf8'));

test('disable writes {enabled: false} to the overlay and leaves the bundled default alone', async () => {
  const context = harness();
  assert.equal(await run(['disable', 'alpha'], context), 0);
  assert.deepEqual(overlayOf(context, 'alpha'), { enabled: false });
  assert.deepEqual(bundledOf(context, 'alpha'), BUNDLED.alpha);
  assert.deepEqual(context.lines, ['Disabled alpha']);
});

test('enable flips the overlay back on and reports the refresh it could not do', async () => {
  const context = harness();
  await run(['disable', 'alpha'], context);
  assert.equal(await run(['on', 'alpha'], context), 0);
  assert.equal(overlayOf(context, 'alpha').enabled, true);
  assert.match(context.errors.join('\n'), /could not cache schema for "alpha"/);
});

test('enable on an unknown upstream fails', async () => {
  const context = harness();
  assert.equal(await run(['enable', 'ghost'], context), 1);
  assert.deepEqual(context.errors, ['Server "ghost" not found']);
  assert.equal(fs.existsSync(path.join(context.overlayDir, 'ghost')), false);
});

test('enable on a locked upstream refuses, names the field, and leaves the overlay alone', async () => {
  const context = harness();
  writeOverlay(context, 'alpha', { enabled: false, locked: true });
  assert.equal(await run(['enable', 'alpha'], context), 1);
  assert.match(context.errors.join('\n'), /"alpha" is locked \(locked: true/);
  assert.match(context.errors.join('\n'), /omega-mcp enable alpha --force/);
  assert.deepEqual(overlayOf(context, 'alpha'), { enabled: false, locked: true });
});

test('enable --force overrides the lock and the lock survives the flip', async () => {
  const context = harness();
  writeOverlay(context, 'alpha', { enabled: false, locked: true });
  assert.equal(await run(['enable', 'alpha', '--force'], context), 0);
  assert.deepEqual(overlayOf(context, 'alpha'), { enabled: true, locked: true });
  assert.equal(context.lines[0], 'Enabled alpha');
});

test('disable on a locked upstream is allowed', async () => {
  const context = harness();
  writeOverlay(context, 'alpha', { enabled: true, locked: true });
  assert.equal(await run(['disable', 'alpha'], context), 0);
  assert.deepEqual(overlayOf(context, 'alpha'), { enabled: false, locked: true });
});

test('remove on a locked private upstream is allowed', async () => {
  const context = harness();
  writeOverlay(context, 'mine', { enabled: false, locked: true, command: 'node', args: ['m.js'] });
  assert.equal(await run(['rm', 'mine'], context), 0);
  assert.equal(fs.existsSync(path.join(context.overlayDir, 'mine')), false);
});

test('add over an existing locked entry refuses, so nothing writes enabled: true', async () => {
  const context = harness();
  writeOverlay(context, 'mine', { enabled: false, locked: true, command: 'node', args: ['m.js'] });
  assert.equal(await run(['add', 'mine', 'node', ECHO_SERVER], context), 1);
  assert.match(context.errors.join('\n'), /already exists/);
  assert.deepEqual(overlayOf(context, 'mine'), { enabled: false, locked: true, command: 'node', args: ['m.js'] });
});

test('add writes a private upstream to the overlay and caches its real tool schema', async () => {
  const context = harness();
  assert.equal(await run(['add', 'echo', 'node', ECHO_SERVER], context), 0);
  const entry = overlayOf(context, 'echo');
  assert.equal(entry.enabled, true);
  assert.equal(entry.command, 'node');
  assert.deepEqual(entry.args, [ECHO_SERVER]);
  assert.deepEqual(entry.tools.map((tool) => tool.name), ['echo', 'ping']);
  assert.deepEqual(context.lines, ['Added echo', 'Cached 2 tool(s) for "echo"']);
});

test('add refuses a name either layer already knows', async () => {
  const context = harness();
  assert.equal(await run(['add', 'alpha', 'node', ECHO_SERVER], context), 1);
  assert.match(context.errors.join('\n'), /already exists/);
  assert.equal(fs.existsSync(path.join(context.overlayDir, 'alpha')), false);
});

test('add without a command prints usage', async () => {
  const context = harness();
  assert.equal(await run(['add', 'echo'], context), 1);
  assert.match(context.errors[0], /Usage: omega-mcp add/);
});

test('refresh caches the tool list into the overlay', async () => {
  const context = harness();
  await run(['add', 'echo', 'node', ECHO_SERVER], context);
  assert.equal(await run(['refresh', 'echo'], context), 0);
  assert.equal(overlayOf(context, 'echo').tools.length, 2);
});

test('refresh on an upstream that cannot start fails with the reason', async () => {
  const context = harness();
  await run(['add', 'broken', 'node', path.join(__dirname, 'fixtures', 'nope.js')], context);
  context.errors.length = 0;
  assert.equal(await run(['refresh', 'broken'], context), 1);
  assert.match(context.errors[0], /^Refresh failed for "broken":/);
});

test('remove deletes a private upstream', async () => {
  const context = harness();
  await run(['add', 'echo', 'node', ECHO_SERVER], context);
  assert.equal(await run(['rm', 'echo'], context), 0);
  assert.equal(fs.existsSync(path.join(context.overlayDir, 'echo')), false);
  assert.equal(context.lines.at(-1), 'Removed echo');
});

test('remove on a bundled default refuses and points at disable', async () => {
  const context = harness();
  assert.equal(await run(['remove', 'alpha'], context), 1);
  assert.match(context.errors[0], /bundled default and cannot be removed.*omega-mcp disable alpha/);
  assert.deepEqual(bundledOf(context, 'alpha'), BUNDLED.alpha);
});

test('remove on a bundled default that has overrides drops only the overrides', async () => {
  const context = harness();
  await run(['disable', 'alpha'], context);
  assert.equal(await run(['remove', 'alpha'], context), 0);
  assert.match(context.lines.at(-1), /the bundled default is back in effect/);
  assert.equal(fs.existsSync(path.join(context.overlayDir, 'alpha')), false);
});

test('list shows every layer with its source and state', async () => {
  const context = harness();
  await run(['add', 'echo', 'node', ECHO_SERVER], context);
  await run(['disable', 'beta'], context);
  context.lines.length = 0;
  assert.equal(await run(['ls'], context), 0);

  const listed = context.lines.join('\n');
  assert.match(listed, /alpha \(bundled\) \(1 tools cached\)/);
  assert.match(listed, /beta \(bundled, overridden\) \(no cache\)/);
  assert.match(listed, /echo \(yours\) \(2 tools cached\)/);
});

test('list marks a locked upstream', async () => {
  const context = harness();
  writeOverlay(context, 'alpha', { enabled: false, locked: true });
  assert.equal(await run(['ls'], context), 0);
  assert.match(context.lines.join('\n'), /alpha \[locked\] \(bundled, overridden\)/);
});

test('help is the no-command default and names the CLI', async () => {
  const context = harness();
  assert.equal(await run([], context), 0);
  assert.match(context.lines[0], /Usage: omega-mcp <command>/);
});

test('an unknown command exits 1', async () => {
  const context = harness();
  assert.equal(await run(['sync'], context), 1);
  assert.match(context.errors[0], /Unknown command: sync/);
});
