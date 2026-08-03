/**
 * Router e2e — a real router process over real stdio, driven by the real MCP
 * client, against the REAL bundled defaults plus a fixture overlay. That
 * combination is the strongest proof available: it exercises the layering,
 * the meta-tools, and the per-session tool list in one go, and it fails if
 * the shipped defaults ever stop parsing.
 *
 * No upstream child is ever started: tool lists come from the cached schemas,
 * and only a cold tool CALL would spawn one.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const registry = require('../src/lib/registry.js');

const ECHO_SERVER = path.join(__dirname, 'fixtures', 'echo-server.js');
const ROUTER = path.join(__dirname, '..', 'src', 'router.js');

// The router process reads the fixture overlay; this side reads the bundled
// layer alone, so a real user overlay cannot colour the expectations.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

const schema = { type: 'object', properties: {} };
const FIXTURE_TOOLS = [
  { name: 'echo', description: 'Echo the text back.', inputSchema: schema },
  { name: 'ping', description: 'Answer with pong.', inputSchema: schema },
];

const META = [
  'router__list_upstreams',
  'router__enable_upstream',
  'router__disable_upstream',
  'router__refresh_upstream',
];

let client;
let overlayDir;

before(async () => {
  overlayDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-e2e-')), 'servers');

  const entries = {
    // Every bundled default off, by the one-key overlay the layering promises.
    ...Object.fromEntries(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).map((name) => [name, { enabled: false }])),
    'fixture-auto': { enabled: true, command: 'node', args: [ECHO_SERVER], tools: FIXTURE_TOOLS },
    'fixture-ondemand': { enabled: true, default: 'on-demand', command: 'node', args: [ECHO_SERVER], tools: FIXTURE_TOOLS },
    'fixture-off': { enabled: false, command: 'node', args: [ECHO_SERVER], tools: FIXTURE_TOOLS },
    'fixture-locked': { enabled: false, locked: true, command: 'node', args: [ECHO_SERVER], tools: FIXTURE_TOOLS },
    // Enabled on disk but on-demand (inactive) — the mid-session lock test
    // writes locked: true into this entry while the router is live.
    'fixture-midlock': { enabled: true, default: 'on-demand', command: 'node', args: [ECHO_SERVER], tools: FIXTURE_TOOLS },
  };
  for (const [name, config] of Object.entries(entries)) {
    fs.mkdirSync(path.join(overlayDir, name), { recursive: true });
    fs.writeFileSync(path.join(overlayDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }

  client = new Client({ name: 'router-e2e', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [ROUTER],
    env: { ...process.env, MCP_ROUTER_SERVERS_DIR: overlayDir },
    stderr: 'ignore',
  }));
});

after(async () => {
  await client.close();
});

const toolNames = async () => (await client.listTools()).tools.map((tool) => tool.name);
const callMeta = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { text: result.content.map((part) => part.text).join(''), isError: result.isError === true };
};

test('the tool list is the meta-tools plus the active upstreams only', async () => {
  assert.deepEqual(await toolNames(), [...META, 'fixture-auto__echo', 'fixture-auto__ping']);
});

test('router__list_upstreams reports every layer with its disk and session state', async () => {
  const rows = JSON.parse((await callMeta('router__list_upstreams', {})).text);
  const byName = Object.fromEntries(rows.map((row) => [row.name, row]));

  assert.deepEqual(byName['fixture-auto'], {
    name: 'fixture-auto',
    enabled_on_disk: true,
    default: 'auto',
    locked: false,
    active_this_session: true,
    spawned: false,
    tool_count: 2,
    last_error: null,
  });
  assert.equal(byName['fixture-ondemand'].active_this_session, false, 'on-demand upstreams start inactive');
  assert.equal(byName['fixture-off'].enabled_on_disk, false);
  assert.equal(byName['fixture-locked'].locked, true, 'the locked state is visible from inside a chat');

  // The shipped defaults are present and each one was turned off by its
  // single-key overlay — the layering, end to end through a real process.
  for (const name of Object.keys(registry.loadUpstreams(BUNDLED_ONLY))) {
    assert.equal(byName[name].enabled_on_disk, false, `${name} should be off via the overlay`);
    assert.ok(byName[name].tool_count > 0, `${name} should still carry its bundled tools cache`);
  }
});

test('enable/disable is a per-session round-trip on the visible tool list', async () => {
  const enabled = await callMeta('router__enable_upstream', { name: 'fixture-ondemand' });
  assert.equal(enabled.isError, false);
  assert.match(enabled.text, /Enabled "fixture-ondemand" for this session \(2 tools\)/);
  assert.deepEqual(await toolNames(), [...META, 'fixture-auto__echo', 'fixture-auto__ping', 'fixture-ondemand__echo', 'fixture-ondemand__ping']);

  const disabled = await callMeta('router__disable_upstream', { name: 'fixture-ondemand' });
  assert.equal(disabled.isError, false);
  assert.deepEqual(await toolNames(), [...META, 'fixture-auto__echo', 'fixture-auto__ping']);
});

test('an env override is accepted and reported', async () => {
  const result = await callMeta('router__enable_upstream', { name: 'fixture-ondemand', env: { OMEGA_CDP_PORT: '9333' } });
  assert.match(result.text, /Env override set \(OMEGA_CDP_PORT\)/);
  await callMeta('router__disable_upstream', { name: 'fixture-ondemand' });
});

test('a non-string env value is refused', async () => {
  const result = await callMeta('router__enable_upstream', { name: 'fixture-ondemand', env: { OMEGA_CDP_PORT: 9333 } });
  assert.equal(result.isError, true);
  assert.match(result.text, /env values must be strings/);
});

test('an upstream disabled on disk cannot be activated, and says how to fix it', async () => {
  const result = await callMeta('router__enable_upstream', { name: 'fixture-off' });
  assert.equal(result.isError, true);
  assert.match(result.text, /omega-mcp enable fixture-off/);
});

test('a locked upstream cannot be activated from inside the chat', async () => {
  const result = await callMeta('router__enable_upstream', { name: 'fixture-locked' });
  assert.equal(result.isError, true);
  assert.match(result.text, /"fixture-locked" is locked \(locked: true/);
  assert.equal((await toolNames()).some((tool) => tool.startsWith('fixture-locked__')), false);
});

test('a lock written mid-session is honored for an already-enabled upstream', async () => {
  const configPath = path.join(overlayDir, 'fixture-midlock', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.writeFileSync(configPath, `${JSON.stringify({ ...config, locked: true }, null, 2)}\n`);

  const result = await callMeta('router__enable_upstream', { name: 'fixture-midlock' });
  assert.equal(result.isError, true);
  assert.match(result.text, /"fixture-midlock" is locked \(locked: true/);
  assert.equal((await toolNames()).some((tool) => tool.startsWith('fixture-midlock__')), false);
});

test('an on-disk enable is picked up without restarting the router', async () => {
  fs.writeFileSync(
    path.join(overlayDir, 'fixture-off', 'config.json'),
    `${JSON.stringify({ enabled: true, command: 'node', args: [ECHO_SERVER], tools: FIXTURE_TOOLS }, null, 2)}\n`,
  );
  const result = await callMeta('router__enable_upstream', { name: 'fixture-off' });
  assert.equal(result.isError, false);
  assert.ok((await toolNames()).includes('fixture-off__echo'));
  await callMeta('router__disable_upstream', { name: 'fixture-off' });
});

test('an unknown upstream is an error, not a crash', async () => {
  const result = await callMeta('router__enable_upstream', { name: 'ghost' });
  assert.equal(result.isError, true);
  assert.match(result.text, /Unknown upstream: ghost/);
});

test('calling an inactive upstream tells the session to enable it first', async () => {
  const result = await callMeta('fixture-ondemand__ping', {});
  assert.equal(result.isError, true);
  assert.match(result.text, /inactive in this session\. Call router__enable_upstream/);
});

test('a tool name outside the <upstream>__<tool> shape is refused', async () => {
  const result = await callMeta('nonsense', {});
  assert.equal(result.isError, true);
  assert.match(result.text, /is not in <upstream>__<tool> format/);
});
