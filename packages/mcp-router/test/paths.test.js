/**
 * Paths tests — the two-layer rule (bundled defaults are READ-ONLY inside the
 * package; the `~/.omega/mcp-router/` overlay is the only writable side) and
 * the two env seams tests and power users steer with. Both seams are read at
 * CALL time, never captured at require time — a test that sets one after the
 * module loads must still win.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PACKAGE_ROOT,
  BUNDLED_SERVERS_DIR,
  OVERLAY_ROOT,
  overlayServersDir,
  envFile,
} = require('../src/lib/paths.js');

/**
 * Set an env seam for one test and restore it after.
 *
 * @param {object} t - The node:test context, for restore
 * @param {string} key - The env var
 * @param {string|undefined} value - The value, or undefined to unset
 * @returns {void}
 */
function withEnv(t, key, value) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

test('PACKAGE_ROOT is the package itself — its package.json is the router', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));

  assert.strictEqual(manifest.name, '@omega.js/mcp-router');
});

test('the bundled servers dir ships inside the package and the overlay never does', () => {
  assert.strictEqual(BUNDLED_SERVERS_DIR, path.join(PACKAGE_ROOT, 'servers'));
  assert.strictEqual(fs.existsSync(BUNDLED_SERVERS_DIR), true);

  assert.strictEqual(OVERLAY_ROOT, path.join(os.homedir(), '.omega', 'mcp-router'));
  assert.strictEqual(OVERLAY_ROOT.startsWith(PACKAGE_ROOT), false);
});

test('unset seams fall back to the overlay layout', (t) => {
  withEnv(t, 'MCP_ROUTER_SERVERS_DIR', undefined);
  withEnv(t, 'MCP_ROUTER_ENV_FILE', undefined);

  assert.strictEqual(overlayServersDir(), path.join(os.homedir(), '.omega', 'mcp-router', 'servers'));
  assert.strictEqual(envFile(), path.join(os.homedir(), '.omega', 'mcp-router', '.env'));
});

test('each seam overrides its own path and nothing else', (t) => {
  withEnv(t, 'MCP_ROUTER_SERVERS_DIR', '/tmp/mcp-router-test/servers');
  withEnv(t, 'MCP_ROUTER_ENV_FILE', undefined);

  assert.strictEqual(overlayServersDir(), '/tmp/mcp-router-test/servers');
  assert.strictEqual(envFile(), path.join(os.homedir(), '.omega', 'mcp-router', '.env'));

  withEnv(t, 'MCP_ROUTER_SERVERS_DIR', undefined);
  withEnv(t, 'MCP_ROUTER_ENV_FILE', '/tmp/mcp-router-test/.env');

  assert.strictEqual(overlayServersDir(), path.join(os.homedir(), '.omega', 'mcp-router', 'servers'));
  assert.strictEqual(envFile(), '/tmp/mcp-router-test/.env');
});

test('seams are read per call, so a change mid-process takes effect', (t) => {
  withEnv(t, 'MCP_ROUTER_SERVERS_DIR', '/tmp/mcp-router-first');
  assert.strictEqual(overlayServersDir(), '/tmp/mcp-router-first');

  process.env.MCP_ROUTER_SERVERS_DIR = '/tmp/mcp-router-second';
  assert.strictEqual(overlayServersDir(), '/tmp/mcp-router-second');
});
