/**
 * Dependency self-bootstrap for launches from a bare checkout.
 *
 * The plugin's .mcp.json runs the router straight out of the marketplace
 * clone, and a fresh clone has no node_modules. Before any SDK import, this
 * installs the package's own dependencies once — a no-op whenever they
 * already resolve (dev checkouts with the monorepo installed, every launch
 * after the first).
 *
 * This file runs BEFORE node_modules exists, so everything it requires — and
 * everything those files require — must stay builtin-only.
 */

const path = require('node:path');

const { resolveBin } = require('./lib/env.js');
const { log } = require('./lib/log.js');

const PKG_ROOT = path.join(__dirname, '..');

// The exact specifier the router imports — the SDK's exports map has no
// ./package.json entry, so probing a real export is the honest check.
const PROBE = '@modelcontextprotocol/sdk/server/index.js';

/**
 * Make the package's dependencies resolvable, installing them if needed.
 *
 * @param {object} [options] - `{ resolve, spawnSync, pkgRoot }` seams for tests
 * @returns {boolean} True when dependencies resolve (or were just installed)
 */
function ensureDeps(options = {}) {
  const resolve = options.resolve || require.resolve;
  const spawnSync = options.spawnSync || require('node:child_process').spawnSync;
  const pkgRoot = options.pkgRoot || PKG_ROOT;

  try {
    resolve(PROBE, { paths: [pkgRoot] });
    return true;
  } catch {
    log('info', 'first launch from a bare checkout — installing dependencies…');
  }

  // The bare name would need a PATH the router may not have (same reason the
  // spawn shapes resolve theirs); win32 still needs the shell to run a .cmd,
  // and quoting keeps the default `C:\Program Files\nodejs` install working.
  const shell = process.platform === 'win32';
  const npm = resolveBin('npm');

  // stdout stays 'ignore' — this process's stdout is the MCP wire.
  const result = spawnSync(shell ? `"${npm}"` : npm, ['install', '--omit=dev', '--no-fund', '--no-audit'], {
    cwd: pkgRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell,
  });

  if (result.status !== 0) {
    log('fatal', `npm install failed — run it in ${pkgRoot} and relaunch`);
    return false;
  }
  return true;
}

module.exports = { ensureDeps, PKG_ROOT };
