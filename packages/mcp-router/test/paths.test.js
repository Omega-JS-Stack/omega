/**
 * Paths tests — the two-layer rule (bundled defaults are READ-ONLY inside the
 * package; the `~/.omega/mcp-router/` overlay is the only writable side) and
 * the two env seams tests and power users steer with. Both seams are read at
 * CALL time, never captured at require time — a test that sets one after the
 * module loads must still win.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
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
 * @param {object} t - The case's ctx, for restore
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

module.exports = defineCases({
  type: 'group',
  description: 'paths',
  tests: [
    {
      name: 'PACKAGE_ROOT is the package itself — its package.json is the router',
      run: (ctx) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));

        ctx.expect(manifest.name).toBe('@omega.js/mcp-router');
      },
    },

    {
      name: 'the bundled servers dir ships inside the package and the overlay never does',
      run: (ctx) => {
        ctx.expect(BUNDLED_SERVERS_DIR).toBe(path.join(PACKAGE_ROOT, 'servers'));
        ctx.expect(fs.existsSync(BUNDLED_SERVERS_DIR)).toBe(true);

        ctx.expect(OVERLAY_ROOT).toBe(path.join(os.homedir(), '.omega', 'mcp-router'));
        ctx.expect(OVERLAY_ROOT.startsWith(PACKAGE_ROOT)).toBe(false);
      },
    },

    {
      name: 'unset seams fall back to the overlay layout',
      run: (ctx) => {
        withEnv(ctx, 'MCP_ROUTER_SERVERS_DIR', undefined);
        withEnv(ctx, 'MCP_ROUTER_ENV_FILE', undefined);

        ctx.expect(overlayServersDir()).toBe(path.join(os.homedir(), '.omega', 'mcp-router', 'servers'));
        ctx.expect(envFile()).toBe(path.join(os.homedir(), '.omega', 'mcp-router', '.env'));
      },
    },

    {
      name: 'each seam overrides its own path and nothing else',
      run: (ctx) => {
        withEnv(ctx, 'MCP_ROUTER_SERVERS_DIR', '/tmp/mcp-router-test/servers');
        withEnv(ctx, 'MCP_ROUTER_ENV_FILE', undefined);

        ctx.expect(overlayServersDir()).toBe('/tmp/mcp-router-test/servers');
        ctx.expect(envFile()).toBe(path.join(os.homedir(), '.omega', 'mcp-router', '.env'));

        withEnv(ctx, 'MCP_ROUTER_SERVERS_DIR', undefined);
        withEnv(ctx, 'MCP_ROUTER_ENV_FILE', '/tmp/mcp-router-test/.env');

        ctx.expect(overlayServersDir()).toBe(path.join(os.homedir(), '.omega', 'mcp-router', 'servers'));
        ctx.expect(envFile()).toBe('/tmp/mcp-router-test/.env');
      },
    },

    {
      name: 'seams are read per call, so a change mid-process takes effect',
      run: (ctx) => {
        withEnv(ctx, 'MCP_ROUTER_SERVERS_DIR', '/tmp/mcp-router-first');
        ctx.expect(overlayServersDir()).toBe('/tmp/mcp-router-first');

        process.env.MCP_ROUTER_SERVERS_DIR = '/tmp/mcp-router-second';
        ctx.expect(overlayServersDir()).toBe('/tmp/mcp-router-second');
      },
    },
  ],
});
