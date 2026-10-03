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

const defineCases = require('@omega.js/devkit/test/define-cases');
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

const toolNames = async () => (await client.listTools()).tools.map((tool) => tool.name);
const callMeta = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { text: result.content.map((part) => part.text).join(''), isError: result.isError === true };
};

module.exports = defineCases({
  type: 'group',
  description: 'router',
  setup: async () => {
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
      // Points at a command that does not exist, and carries no cached tools.
      // The mid-session command test rewrites it to `node` while the router is
      // live, so only a re-read of disk can make the refresh spawn succeed.
      'fixture-recommand': { enabled: true, default: 'on-demand', command: 'no-such-binary-omega', args: [ECHO_SERVER], tools: [] },
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
  },
  cleanup: async () => {
    await client.close();
  },
  tests: [
    {
      name: 'the tool list is the meta-tools plus the active upstreams only',
      run: async (ctx) => {
        ctx.expect(await toolNames()).toEqual([...META, 'fixture-auto__echo', 'fixture-auto__ping']);
      },
    },

    {
      name: 'router__list_upstreams reports every layer with its disk and session state',
      run: async (ctx) => {
        const rows = JSON.parse((await callMeta('router__list_upstreams', {})).text);
        const byName = Object.fromEntries(rows.map((row) => [row.name, row]));

        ctx.expect(byName['fixture-auto']).toEqual({
          name: 'fixture-auto',
          enabled_on_disk: true,
          default: 'auto',
          locked: false,
          active_this_session: true,
          spawned: false,
          pid: null,
          idle_ms: null,
          tool_count: 2,
          last_error: null,
        });
        ctx.expect(byName['fixture-ondemand'].active_this_session, 'on-demand upstreams start inactive').toBe(false);
        ctx.expect(byName['fixture-off'].enabled_on_disk).toBe(false);
        ctx.expect(byName['fixture-locked'].locked, 'the locked state is visible from inside a chat').toBe(true);

        // The shipped defaults are present and each one was turned off by its
        // single-key overlay — the layering, end to end through a real process.
        for (const name of Object.keys(registry.loadUpstreams(BUNDLED_ONLY))) {
          ctx.expect(byName[name].enabled_on_disk, `${name} should be off via the overlay`).toBe(false);
          ctx.expect(byName[name].tool_count > 0, `${name} should still carry its bundled tools cache`).toBeTruthy();
        }
      },
    },

    {
      name: 'enable/disable is a per-session round-trip on the visible tool list',
      run: async (ctx) => {
        const enabled = await callMeta('router__enable_upstream', { name: 'fixture-ondemand' });
        ctx.expect(enabled.isError).toBe(false);
        ctx.expect(enabled.text).toMatch(/Enabled "fixture-ondemand" for this session \(2 tools\)/);
        ctx.expect(await toolNames()).toEqual([...META, 'fixture-auto__echo', 'fixture-auto__ping', 'fixture-ondemand__echo', 'fixture-ondemand__ping']);

        const disabled = await callMeta('router__disable_upstream', { name: 'fixture-ondemand' });
        ctx.expect(disabled.isError).toBe(false);
        ctx.expect(await toolNames()).toEqual([...META, 'fixture-auto__echo', 'fixture-auto__ping']);
      },
    },

    {
      name: 'an env override is accepted and reported',
      run: async (ctx) => {
        const result = await callMeta('router__enable_upstream', { name: 'fixture-ondemand', env: { OMEGA_CDP_PORT: '9333' } });
        ctx.expect(result.text).toMatch(/Env override set \(OMEGA_CDP_PORT\)/);
        await callMeta('router__disable_upstream', { name: 'fixture-ondemand' });
      },
    },

    {
      name: 'a non-string env value is refused',
      run: async (ctx) => {
        const result = await callMeta('router__enable_upstream', { name: 'fixture-ondemand', env: { OMEGA_CDP_PORT: 9333 } });
        ctx.expect(result.isError).toBe(true);
        ctx.expect(result.text).toMatch(/env values must be strings/);
      },
    },

    {
      name: 'an upstream disabled on disk cannot be activated, and says how to fix it',
      run: async (ctx) => {
        const result = await callMeta('router__enable_upstream', { name: 'fixture-off' });
        ctx.expect(result.isError).toBe(true);
        ctx.expect(result.text).toMatch(/omega-mcp enable fixture-off/);
      },
    },

    {
      name: 'a locked upstream cannot be activated from inside the chat',
      run: async (ctx) => {
        const result = await callMeta('router__enable_upstream', { name: 'fixture-locked' });
        ctx.expect(result.isError).toBe(true);
        ctx.expect(result.text).toMatch(/"fixture-locked" is locked \(locked: true/);
        ctx.expect((await toolNames()).some((tool) => tool.startsWith('fixture-locked__'))).toBe(false);
      },
    },

    {
      name: 'a lock written mid-session is honored for an already-enabled upstream',
      run: async (ctx) => {
        const configPath = path.join(overlayDir, 'fixture-midlock', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        fs.writeFileSync(configPath, `${JSON.stringify({ ...config, locked: true }, null, 2)}\n`);

        const result = await callMeta('router__enable_upstream', { name: 'fixture-midlock' });
        ctx.expect(result.isError).toBe(true);
        ctx.expect(result.text).toMatch(/"fixture-midlock" is locked \(locked: true/);
        ctx.expect((await toolNames()).some((tool) => tool.startsWith('fixture-midlock__'))).toBe(false);
      },
    },

    {
      name: 'an on-disk enable is picked up without restarting the router',
      run: async (ctx) => {
        fs.writeFileSync(
          path.join(overlayDir, 'fixture-off', 'config.json'),
          `${JSON.stringify({ enabled: true, command: 'node', args: [ECHO_SERVER], tools: FIXTURE_TOOLS }, null, 2)}\n`,
        );
        const result = await callMeta('router__enable_upstream', { name: 'fixture-off' });
        ctx.expect(result.isError).toBe(false);
        ctx.expect((await toolNames()).includes('fixture-off__echo')).toBeTruthy();
        await callMeta('router__disable_upstream', { name: 'fixture-off' });
      },
    },

    {
      name: 'a command re-pointed mid-session is what refresh spawns',
      run: async (ctx) => {
        const configPath = path.join(overlayDir, 'fixture-recommand', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        fs.writeFileSync(configPath, `${JSON.stringify({ ...config, command: 'node' }, null, 2)}\n`);

        const result = await callMeta('router__refresh_upstream', { name: 'fixture-recommand' });
        ctx.expect(result.isError, result.text).toBe(false);
        ctx.expect(result.text).toMatch(/Refreshed "fixture-recommand" — 2 tools/);

        // The tools came from the child the NEW command started: the entry booted
        // with an empty cache, so nothing else could have supplied them.
        const cached = JSON.parse(fs.readFileSync(configPath, 'utf8')).tools;
        ctx.expect(cached.map((tool) => tool.name)).toEqual(['echo', 'ping']);
      },
    },

    {
      name: 'an unknown upstream is an error, not a crash',
      run: async (ctx) => {
        const result = await callMeta('router__enable_upstream', { name: 'ghost' });
        ctx.expect(result.isError).toBe(true);
        ctx.expect(result.text).toMatch(/Unknown upstream: ghost/);
      },
    },

    {
      name: 'calling an inactive upstream tells the session to enable it first',
      run: async (ctx) => {
        const result = await callMeta('fixture-ondemand__ping', {});
        ctx.expect(result.isError).toBe(true);
        ctx.expect(result.text).toMatch(/inactive in this session\. Call router__enable_upstream/);
      },
    },

    {
      name: 'a tool name outside the <upstream>__<tool> shape is refused',
      run: async (ctx) => {
        const result = await callMeta('nonsense', {});
        ctx.expect(result.isError).toBe(true);
        ctx.expect(result.text).toMatch(/is not in <upstream>__<tool> format/);
      },
    },
  ],
});
