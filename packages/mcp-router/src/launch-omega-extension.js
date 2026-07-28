#!/usr/bin/env node
/**
 * The `omega-extension` upstream's launcher.
 *
 * The extension MCP server lives inside @omega.js/manager, at
 * `extension/mcp-server/index.js`. This resolves the manager's package root
 * from its main export — the exports map deliberately has no `./package.json`
 * entry, so the root is the main file's directory's parent — and runs the
 * server with stdio forwarded to the router.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { log } = require('./lib/log.js');

const MANAGER_PACKAGE = '@omega.js/manager';
const SERVER_RELATIVE = path.join('extension', 'mcp-server', 'index.js');

/**
 * The installed @omega.js/manager package root.
 *
 * @param {object} [options] - `{ resolve }` — the resolver seam (defaults to require.resolve)
 * @returns {string|null} Absolute package root, or null when the manager is not installed
 */
function resolveManagerRoot(options = {}) {
  const resolve = options.resolve || require.resolve;
  try {
    // main is dist/index.js — two dirnames up from it is the package root.
    return path.dirname(path.dirname(resolve(MANAGER_PACKAGE)));
  } catch {
    return null;
  }
}

/**
 * The extension MCP server entry inside an installed manager.
 *
 * @param {object} [options] - `{ resolve, exists }` seams for tests
 * @returns {{server: string}|{error: string}} The entry path, or why there is none
 */
function resolveServerPath(options = {}) {
  const exists = options.exists || fs.existsSync;
  const root = resolveManagerRoot(options);
  if (!root) return { error: `${MANAGER_PACKAGE} is not installed — the omega-extension upstream needs it on disk.` };

  const server = path.join(root, SERVER_RELATIVE);
  if (!exists(server)) return { error: `${MANAGER_PACKAGE} is installed at ${root} but ${SERVER_RELATIVE} is missing.` };
  return { server };
}

/**
 * Resolve the server and run it.
 *
 * @param {object} [options] - `{ resolve, exists, spawn, exit, execPath }` seams for tests
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

module.exports = { resolveManagerRoot, resolveServerPath, main };

if (require.main === module) main();
