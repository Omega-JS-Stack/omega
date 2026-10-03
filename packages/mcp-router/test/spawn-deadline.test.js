/**
 * The spawn deadline: a real router process, driven by the real MCP client,
 * against an upstream whose child NEVER completes the handshake.
 *
 * Without the deadline that child leaves `spawning` pending forever: the first
 * call hangs and every later call awaits the same dead promise, so the upstream
 * is unusable for the rest of the session. The proof is two calls: each one
 * fails AT the deadline, and each one started its own child.
 *
 * The deadline is shrunk through its env seam (MCP_ROUTER_SPAWN_TIMEOUT_MS);
 * the shipped 30s default is untouched.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
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

const schema = { type: 'object', properties: {} };

let client;
let markerFile;

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

module.exports = defineCases({
  type: 'group',
  description: 'spawn-deadline',
  setup: async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-deadline-'));
    const overlayDir = path.join(root, 'servers');
    markerFile = path.join(root, 'starts.log');

    const entries = {
      // Every bundled default off, by the one-key overlay the layering promises.
      ...Object.fromEntries(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).map((name) => [name, { enabled: false }])),
      'fixture-hang': {
        enabled: true,
        command: 'node',
        args: [HANG_SERVER],
        env: { HANG_MARKER: markerFile },
        tools: [{ name: 'ping', description: 'Never answered.', inputSchema: schema }],
      },
    };
    for (const [name, config] of Object.entries(entries)) {
      fs.mkdirSync(path.join(overlayDir, name), { recursive: true });
      fs.writeFileSync(path.join(overlayDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
    }

    client = new Client({ name: 'router-deadline-e2e', version: '1.0.0' }, { capabilities: {} });
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
  },
  cleanup: async () => {
    await client.close();
  },
  tests: [
    {
      name: 'a child that never finishes the handshake fails at the deadline',
      run: async (ctx) => {
        const result = await callTool('fixture-hang__ping', {});

        ctx.expect(result.isError).toBe(true);
        ctx.expect(result.text).toMatch(/Upstream "fixture-hang" failed: handshake did not finish within 1200ms/);
        ctx.expect(result.elapsed >= DEADLINE_MS, `waited ${result.elapsed}ms, expected at least the deadline`).toBeTruthy();
        // Generous, but far below the SDK's own 60s request timeout: what answered
        // here was the router's deadline, not the client giving up.
        ctx.expect(result.elapsed < 15000, `waited ${result.elapsed}ms, expected the deadline to answer`).toBeTruthy();
        ctx.expect(starts(), 'one child was started').toBe(1);
      },
    },

    {
      name: 'the failure is recorded and the next call spawns a fresh child',
      run: async (ctx) => {
        const rows = JSON.parse((await callTool('router__list_upstreams', {})).text);
        const row = rows.find((entry) => entry.name === 'fixture-hang');
        ctx.expect(row.last_error).toMatch(/handshake did not finish within 1200ms/);
        ctx.expect(row.spawned, 'no client is pinned to the dead child').toBe(false);

        const result = await callTool('fixture-hang__ping', {});

        // The wedge was a pending promise every later call awaited: this call would
        // never have reached a child at all, let alone a new one.
        ctx.expect(starts(), 'the second call started its own child').toBe(2);
        ctx.expect(result.isError).toBe(true);
        ctx.expect(result.text).toMatch(/handshake did not finish within 1200ms/);
        ctx.expect(result.elapsed >= DEADLINE_MS && result.elapsed < 15000, `waited ${result.elapsed}ms`).toBeTruthy();
      },
    },
  ],
});
