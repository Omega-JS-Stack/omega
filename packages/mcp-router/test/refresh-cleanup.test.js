/**
 * The refresh one-shot's post-handshake cleanup: a real router process, driven
 * by the real MCP client, against an upstream whose child handshakes and then
 * FAILS the tools/list read.
 *
 * The connect deadline already terminates a child that never handshakes
 * (refresh-deadline.test.js). This is the other half: past connect, the
 * tools/list read is the last thing that can fail, and a failure there used to
 * jump straight to the outer catch with nothing closing the transport, and the
 * one-shot child then ran for the rest of the session. The failure is also the
 * only news the caller gets, so it has to land in last_error the way a failed
 * spawn's does.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const registry = require('../src/lib/registry.js');

const BROKEN_LIST_SERVER = path.join(__dirname, 'fixtures', 'broken-list-server.js');
const ECHO_SERVER = path.join(__dirname, 'fixtures', 'echo-server.js');
const ROUTER = path.join(__dirname, '..', 'src', 'router.js');

// The router process reads the fixture overlay; this side reads the bundled
// layer alone, so a real user overlay cannot colour the expectations.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

// An ignored extra argv on the fixture child, unique to this run: it makes
// `pgrep -f` name THIS test's children and nothing else, so the sibling
// refresh test running concurrently cannot colour the liveness check.
const TAG = `omega-refresh-cleanup-${process.pid}-${Date.now()}`;

const schema = { type: 'object', properties: {} };

let client;
let overlayDir;

const callTool = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return {
    text: result.content.map((part) => part.text).join(''),
    isError: result.isError === true,
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

module.exports = defineCases({
  type: 'group',
  description: 'refresh-cleanup',
  setup: async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-cleanup-'));
    overlayDir = path.join(root, 'servers');

    const entries = {
      // Every bundled default off, by the one-key overlay the layering promises.
      ...Object.fromEntries(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).map((name) => [name, { enabled: false }])),
      'fixture-broken-list': {
        enabled: true,
        command: 'node',
        args: [BROKEN_LIST_SERVER, TAG],
        tools: [{ name: 'ping', description: 'The stale cached entry a refresh would replace.', inputSchema: schema }],
      },
    };
    for (const [name, config] of Object.entries(entries)) {
      fs.mkdirSync(path.join(overlayDir, name), { recursive: true });
      fs.writeFileSync(path.join(overlayDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
    }

    client = new Client({ name: 'router-refresh-cleanup-e2e', version: '1.0.0' }, { capabilities: {} });
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
      name: 'a refresh whose child fails the tools/list read answers with the failure',
      run: async (ctx) => {
        const result = await callTool('router__refresh_upstream', { name: 'fixture-broken-list' });

        ctx.expect(result.isError).toBe(true);
        // The fixture's own words: the child handshaked and answered, so what failed
        // is the read, not the connect.
        ctx.expect(result.text).toMatch(/Refresh failed for "fixture-broken-list": .*tools\/list is unavailable/);
      },
    },

    {
      name: 'the failed refresh child does not outlive the call',
      run: (ctx) => {
        // The failure path closes the transport, which ends the child's stdin and
        // waits for it to go. Nothing else would ever stop it: the fixture's server
        // holds its own loop open, so a leaked child lives until the router exits.
        ctx.expect(liveChildren(), 'the one-shot child was terminated').toEqual([]);
      },
    },

    {
      name: 'the failed refresh is recorded in last_error',
      run: async (ctx) => {
        const rows = JSON.parse((await callTool('router__list_upstreams', {})).text);
        const row = rows.find((entry) => entry.name === 'fixture-broken-list');

        ctx.expect(row.last_error).toMatch(/tools\/list is unavailable/);
        // The refresh runs its own one-shot client; the session's own slot stays cold.
        ctx.expect(row.spawned).toBe(false);
      },
    },

    {
      name: 'a later successful refresh clears last_error',
      run: async (ctx) => {
        // The refresh re-reads the layered config from disk, so re-pointing the same
        // upstream at the healthy echo fixture makes the next refresh succeed.
        fs.writeFileSync(
          path.join(overlayDir, 'fixture-broken-list', 'config.json'),
          `${JSON.stringify({
            enabled: true,
            command: 'node',
            args: [ECHO_SERVER, TAG],
            tools: [{ name: 'ping', description: 'The stale cached entry a refresh would replace.', inputSchema: schema }],
          }, null, 2)}\n`,
        );

        const result = await callTool('router__refresh_upstream', { name: 'fixture-broken-list' });
        ctx.expect(result.isError, result.text).toBe(false);

        const rows = JSON.parse((await callTool('router__list_upstreams', {})).text);
        ctx.expect(rows.find((entry) => entry.name === 'fixture-broken-list').last_error).toBe(null);
      },
    },
  ],
});
