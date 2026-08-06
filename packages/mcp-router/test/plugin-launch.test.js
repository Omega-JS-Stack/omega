/**
 * The plugin's MCP entry (#144). The omega Claude plugin declares exactly one
 * server, and it launches through `agent-plugins/claude/mcp-router-launch.js`
 * — a file INSIDE the plugin, so the declaration ships to a consumer intact.
 * What has to hold here: the declaration addresses that launcher and nothing
 * outside the plugin, and node resolution from the plugin's own directory
 * finds this package's bin (the live-monorepo era; the published era is the
 * same resolution against an installed package).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_DIR = path.join(__dirname, '..', '..', '..', 'agent-plugins', 'claude');
const ROUTER_BIN = '@omega.js/mcp-router/bin/mcp-router.js';

test('the plugin declares one server, launched from inside the plugin', () => {
  const declaration = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.mcp.json'), 'utf8'));

  assert.deepEqual(Object.keys(declaration.mcpServers), ['mcp-router']);
  assert.deepEqual(declaration.mcpServers['mcp-router'].args, ['${CLAUDE_PLUGIN_ROOT}/mcp-router-launch.js']);
  assert.ok(!JSON.stringify(declaration).includes('..'), 'the declaration never reaches outside the plugin');
  assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'mcp-router-launch.js')), 'the launcher it names is there');
});

test('the launcher resolves this package\'s bin from the plugin directory', () => {
  assert.equal(
    require.resolve(ROUTER_BIN, { paths: [PLUGIN_DIR] }),
    path.join(__dirname, '..', 'bin', 'mcp-router.js')
  );
});
