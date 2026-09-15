#!/usr/bin/env node
/**
 * The `omega-extension` upstream's launcher.
 *
 * The extension MCP server ships INSIDE this package, at
 * `servers/omega-extension/index.js`
 * ([#927](https://github.com/Omega-JS-Stack/omega/issues/927)). It used to live
 * in `@omega.js/manager`'s `extension/` tree, which that package never
 * publishes, so the upstream could not start on any install but a monorepo
 * checkout. There is nothing to resolve any more: the server is a file this
 * package ships, and everything it imports (the MCP SDK, `ws`) is a dependency
 * of this package. So the launcher runs it on this node with stdio forwarded to
 * the router.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { log } = require('./lib/log.js');

const SERVER = path.join(__dirname, '..', 'servers', 'omega-extension', 'index.js');

/**
 * The extension MCP server this package ships.
 *
 * @param {object} [options] - `{ exists }`, the existence seam (defaults to fs.existsSync)
 * @returns {{server: string}|{error: string}} The entry path, or why there is none
 */
function resolveServerPath(options = {}) {
  const exists = options.exists || fs.existsSync;

  // The only way this misses is a broken install of this package, so it says so
  // rather than pointing at anything the user could install.
  if (!exists(SERVER)) return { error: `${SERVER} is missing: @omega.js/mcp-router ships the omega-extension server itself, so this install is incomplete.` };

  return { server: SERVER };
}

/**
 * Resolve the server and run it.
 *
 * @param {object} [options] - `{ exists, spawn, exit, execPath }` seams for tests
 * @returns {void}
 */
function main(options = {}) {
  const spawnFn = options.spawn || spawn;
  const exit = options.exit || ((code) => process.exit(code));

  const resolved = resolveServerPath(options);
  if (resolved.error) {
    log('fatal', resolved.error);
    return exit(1);
  }

  const child = spawnFn(options.execPath || process.execPath, [resolved.server], { stdio: 'inherit' });
  child.on('exit', (code, signal) => exit(signal ? 1 : code ?? 0));
  return undefined;
}

module.exports = { SERVER, resolveServerPath, main };

if (require.main === module) main();
