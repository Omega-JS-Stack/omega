/**
 * The refresh one-shot's READ budget: a real router process, driven by the real
 * MCP client, against an upstream whose child handshakes and then STALLS on the
 * tools/list read.
 *
 * The connect phase has always carried the router's own budget
 * (refresh-deadline.test.js), and a read that FAILS is answered and cleaned up
 * at once (refresh-cleanup.test.js). A read that neither answers nor fails is
 * the remaining shape: with no request timeout the caller holds for the SDK's
 * 60s default before anything terminates the child. The read runs on the same
 * budget as the connect, so the refresh answers there instead.
 *
 * The budget is shrunk through its env seam (MCP_ROUTER_SPAWN_TIMEOUT_MS); the
 * shipped 30s default is untouched.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const registry = require('../src/lib/registry.js');

const STALL_LIST_SERVER = path.join(__dirname, 'fixtures', 'stall-list-server.js');
const ROUTER = path.join(__dirname, '..', 'src', 'router.js');

// The router process reads the fixture overlay; this side reads the bundled
// layer alone, so a real user overlay cannot colour the expectations.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

const BUDGET_MS = 2000;

// An ignored extra argv on the fixture child, unique to this run: it makes
// `pgrep -f` name THIS test's children and nothing else, so the sibling
// refresh tests running concurrently cannot colour the liveness check.
const TAG = `omega-refresh-timeout-${process.pid}-${Date.now()}`;

const schema = { type: 'object', properties: {} };

let client;
let refresh;

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-timeout-'));
  const overlayDir = path.join(root, 'servers');

  const entries = {
    // Every bundled default off, by the one-key overlay the layering promises.
    ...Object.fromEntries(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).map((name) => [name, { enabled: false }])),
    'fixture-stall-list': {
      enabled: true,
      command: 'node',
      args: [STALL_LIST_SERVER, TAG],
      tools: [{ name: 'ping', description: 'The stale cached entry a refresh would replace.', inputSchema: schema }],
    },
  };
  for (const [name, config] of Object.entries(entries)) {
    fs.mkdirSync(path.join(overlayDir, name), { recursive: true });
    fs.writeFileSync(path.join(overlayDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }

  client = new Client({ name: 'router-refresh-timeout-e2e', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [ROUTER],
    env: {
      ...process.env,
      MCP_ROUTER_SERVERS_DIR: overlayDir,
      MCP_ROUTER_SPAWN_TIMEOUT_MS: String(BUDGET_MS),
    },
    stderr: 'ignore',
  }));
});

after(async () => {
  await client.close();
});

const callTool = async (name, args) => {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  return {
    text: result.content.map((part) => part.text).join(''),
    isError: result.isError === true,
    elapsed: Date.now() - started,
  };
};

// No shell: `pgrep -f` would otherwise match the `sh -c` wrapper's own argv.
const liveChildren = () => {
  try {
    return execFileSync('pgrep', ['-f', TAG], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch {
    // pgrep exits 1 when nothing matches.
    return [];
  }
};

test('a refresh whose child stalls on the tools/list read fails on a timeout', async () => {
  refresh = await callTool('router__refresh_upstream', { name: 'fixture-stall-list' });

  assert.equal(refresh.isError, true);
  // The SDK's own words for a request that hit its deadline. The child
  // handshaked and stayed on the wire, so nothing here is a transport failure.
  assert.match(refresh.text, /Refresh failed for "fixture-stall-list": .*Request timed out/);
});

test('the stalled read answers on the router budget, not the SDK default', () => {
  assert.ok(refresh.elapsed >= BUDGET_MS, `waited ${refresh.elapsed}ms, expected at least the budget`);
  // Generous, but far below the SDK's own 60s request timeout: what answered
  // here was the budget the router passed, not the client's default.
  assert.ok(refresh.elapsed < 15000, `waited ${refresh.elapsed}ms, expected the budget to answer`);
});

test('the stalled refresh child does not outlive the call', () => {
  // The failure path closes the transport, which ends the child's stdin and
  // waits for it to go. Nothing else would ever stop it: the fixture's server
  // holds its own loop open, so a leaked child lives until the router exits.
  assert.deepEqual(liveChildren(), [], 'the one-shot child was terminated');
});

test('the timed-out refresh is recorded in last_error', async () => {
  const rows = JSON.parse((await callTool('router__list_upstreams', {})).text);
  const row = rows.find((entry) => entry.name === 'fixture-stall-list');

  assert.match(row.last_error, /Request timed out/);
  // The refresh runs its own one-shot client; the session's own slot stays cold.
  assert.equal(row.spawned, false);
});
