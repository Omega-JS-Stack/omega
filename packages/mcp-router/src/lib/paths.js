/**
 * Where the router reads and writes.
 *
 * Two layers, one direction: the BUNDLED defaults ship inside the package
 * (read-only — for a consumer they live in node_modules), and the OVERLAY
 * under `~/.omega/mcp-router/` is the only thing anything ever writes.
 *
 * Both env seams exist for tests and power users:
 *   MCP_ROUTER_SERVERS_DIR — overrides the overlay servers dir
 *   MCP_ROUTER_ENV_FILE    — overrides the overlay .env path
 */

const os = require('node:os');
const path = require('node:path');

// src/lib/paths.js → the package root is two levels up.
const PACKAGE_ROOT = path.join(__dirname, '..', '..');

const BUNDLED_SERVERS_DIR = path.join(PACKAGE_ROOT, 'servers');

const OVERLAY_ROOT = path.join(os.homedir(), '.omega', 'mcp-router');

/**
 * The overlay servers dir for this process.
 *
 * @returns {string} Absolute path
 */
function overlayServersDir() {
  return process.env.MCP_ROUTER_SERVERS_DIR || path.join(OVERLAY_ROOT, 'servers');
}

/**
 * The .env file secrets interpolate from.
 *
 * @returns {string} Absolute path (the file need not exist)
 */
function envFile() {
  return process.env.MCP_ROUTER_ENV_FILE || path.join(OVERLAY_ROOT, '.env');
}

module.exports = { PACKAGE_ROOT, BUNDLED_SERVERS_DIR, OVERLAY_ROOT, overlayServersDir, envFile };
