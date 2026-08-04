/**
 * The refresh deadline: a real router process, driven by the real MCP client,
 * against an upstream whose child NEVER completes the handshake.
 *
 * router__refresh_upstream spawns its OWN one-shot child. Without the deadline
 * that call waits on the SDK's 60s request timeout, and without the failure
 * close the child it started keeps running until the router exits. The proof
 * is one refresh: it answers AT the deadline, and the child it started is gone
 * by the time it answers.
 *
 * The deadline is shrunk through its env seam (MCP_ROUTER_SPAWN_TIMEOUT_MS);
 * the shipped 30s default is untouched.
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

const HANG_SERVER = path.join(__dirname, 'fixtures', 'hang-server.js');
const ROUTER = path.join(__dirname, '..', 'src', 'router.js');

// The router process reads the fixture overlay; this side reads the bundled
// layer alone, so a real user overlay cannot colour the expectations.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

const DEADLINE_MS = 1200;

// An ignored extra argv on the fixture child, unique to this run: it makes
// `pgrep -f` name THIS test's children and nothing else, so the sibling
// deadline test running concurrently cannot colour the liveness check.
const TAG = `omega-refresh-deadline-${process.pid}-${Date.now()}`;

const schema = { type: 'object', properties: {} };

let client;
let markerFile;

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-refresh-'));
  const overlayDir = path.join(root, 'servers');
  markerFile = path.join(root, 'starts.log');

  const entries = {
    // Every bundled default off, by the one-key overlay the layering promises.
    ...Object.fromEntries(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).map((name) => [name, { enabled: false }])),
    'fixture-hang': {
      enabled: true,
      command: 'node',
      args: [HANG_SERVER, TAG],
      env: { HANG_MARKER: markerFile },
      tools: [{ name: 'ping', description: 'Never answered.', inputSchema: schema }],
    },
  };
  for (const [name, config] of Object.entries(entries)) {
    fs.mkdirSync(path.join(overlayDir, name), { recursive: true });
    fs.writeFileSync(path.join(overlayDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }

  client = new Client({ name: 'router-refresh-e2e', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [ROUTER],
    env: {
      ...process.env,
      MCP_ROUTER_SERVERS_DIR: overlayDir,
      MCP_ROUTER_SPAWN_TIMEOUT_MS: String(DEADLINE_MS),
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

const starts = () => fs.readFileSync(markerFile, 'utf8').trim().split('\n').filter(Boolean).length;

// No shell: `pgrep -f` would otherwise match the `sh -c` wrapper's own argv.
const liveChildren = () => {
  try {
    return execFileSync('pgrep', ['-f', TAG], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch {
    // pgrep exits 1 when nothing matches.
    return [];
  }
};

test('a refresh whose child never finishes the handshake fails at the deadline', async () => {
  const result = await callTool('router__refresh_upstream', { name: 'fixture-hang' });

  assert.equal(result.isError, true);
  assert.match(result.text, /Refresh failed for "fixture-hang": handshake did not finish within 1200ms/);
  assert.ok(result.elapsed >= DEADLINE_MS, `waited ${result.elapsed}ms, expected at least the deadline`);
  // Generous, but far below the SDK's own 60s request timeout: what answered
  // here was the router's deadline, not the client giving up.
  assert.ok(result.elapsed < 15000, `waited ${result.elapsed}ms, expected the deadline to answer`);
  assert.equal(starts(), 1, 'the refresh started its own child');
});

test('the stuck refresh child does not outlive the call', () => {
  // The failure path closes the transport, which ends the child's stdin and
  // waits for it to go. Nothing else would ever stop it: the fixture holds
  // its own loop open, so a leaked child lives until the router exits.
  assert.deepEqual(liveChildren(), [], 'the one-shot child was terminated');
});
