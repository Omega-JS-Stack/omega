#!/usr/bin/env node
/**
 * The `chrome-devtools-extension` upstream's launcher.
 *
 * chrome-devtools-mcp needs an explicit executable to drive an unpacked
 * extension, and the one every machine already has is Chrome for Testing in
 * puppeteer's download cache. This finds the newest CFT there — platform-aware,
 * because the cache lays each platform out differently — and execs the MCP
 * server against it, forwarding stdio so the router talks to it as usual.
 *
 * Set OMEGA_EXTENSION_PATH to the unpacked extension directory before the
 * session starts and it is loaded into that Chrome.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { resolveBin } = require('./lib/env.js');
const { log } = require('./lib/log.js');

const MCP_PACKAGE = 'chrome-devtools-mcp@1.4.0';

/**
 * Where puppeteer downloads Chrome for Testing.
 *
 * @returns {string} Absolute cache path
 */
function defaultCacheDir() {
  return path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
}

/**
 * The executable a CFT version directory holds on one platform. macOS hides
 * it inside an .app bundle whose name changes with the channel, so that leg
 * globs; linux and windows are fixed paths.
 *
 * @param {string} versionDir - Absolute `<cache>/<version>` directory
 * @param {string} platform - A process.platform value
 * @param {string} arch - A process.arch value
 * @returns {string|null} Absolute executable path, or null when this dir has none
 */
function executableIn(versionDir, platform, arch) {
  if (platform === 'darwin') {
    const root = path.join(versionDir, arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64');
    let bundles;
    try {
      bundles = fs.readdirSync(root).filter((entry) => entry.endsWith('.app'));
    } catch {
      return null;
    }
    for (const bundle of bundles) {
      const macos = path.join(root, bundle, 'Contents', 'MacOS');
      let binaries;
      try {
        binaries = fs.readdirSync(macos);
      } catch {
        continue;
      }
      if (binaries.length > 0) return path.join(macos, binaries[0]);
    }
    return null;
  }

  const relative = platform === 'win32'
    ? path.join('chrome-win64', 'chrome.exe')
    : path.join('chrome-linux64', 'chrome');
  const executable = path.join(versionDir, relative);
  return fs.existsSync(executable) ? executable : null;
}

/**
 * Compare two cache directory names (`mac_arm-150.0.7871.24`) by version,
 * newest first — a plain string sort puts 99 above 150.
 *
 * @param {string} a - A directory name
 * @param {string} b - Another directory name
 * @returns {number} Sort order
 */
function byVersionDesc(a, b) {
  const parts = (name) => (name.split('-').pop() || '').split('.').map((piece) => Number.parseInt(piece, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

/**
 * The newest Chrome for Testing executable in the cache.
 *
 * @param {object} [options] - `{ cacheDir, platform, arch }` — all injectable for tests
 * @returns {string|null} Absolute executable path, or null when the cache holds none
 */
function findChromeForTesting(options = {}) {
  const cacheDir = options.cacheDir || defaultCacheDir();
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;

  let versions;
  try {
    versions = fs.readdirSync(cacheDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return null;
  }

  for (const version of versions.sort(byVersionDesc)) {
    const executable = executableIn(path.join(cacheDir, version), platform, arch);
    if (executable) return executable;
  }
  return null;
}

/**
 * The chrome-devtools-mcp argv for a found executable.
 *
 * @param {string} executable - Absolute Chrome for Testing path
 * @param {object} env - Environment to read OMEGA_EXTENSION_PATH from
 * @returns {string[]} Arguments for `npx`
 */
function buildArgs(executable, env) {
  const args = [
    '-y',
    MCP_PACKAGE,
    '--isolated',
    '--acceptInsecureCerts',
    '--usage-statistics=false',
    `--executablePath=${executable}`,
  ];
  if (env.OMEGA_EXTENSION_PATH) {
    args.push(`--chromeArg=--load-extension=${env.OMEGA_EXTENSION_PATH}`);
    args.push('--ignoreDefaultChromeArg=--disable-extensions');
  }
  args.push('--categoryExtensions');
  return args;
}

/**
 * Find CFT and exec the MCP server against it.
 *
 * @param {object} [options] - `{ find, spawn, env, exit }` seams for tests
 * @returns {void}
 */
function main(options = {}) {
  const find = options.find || findChromeForTesting;
  const spawnFn = options.spawn || spawn;
  const env = options.env || process.env;
  const exit = options.exit || ((code) => process.exit(code));

  const executable = find();
  if (!executable) {
    // No silent fallback to the user's own Chrome: an extension test in the
    // personal browser is exactly what this upstream exists to avoid.
    log('fatal', `No Chrome for Testing found in ${defaultCacheDir()}. Install one with \`npx puppeteer browsers install chrome\`.`);
    return exit(1);
  }

  // win32 has no directly spawnable `npx` — it is npx.cmd, which Node only
  // runs through a shell; quoting keeps the resolved absolute path working
  // from the default `C:\Program Files\nodejs` install.
  const shell = process.platform === 'win32';
  const npx = resolveBin('npx');
  const child = spawnFn(shell ? `"${npx}"` : npx, buildArgs(executable, env), { stdio: 'inherit', env, shell });
  child.on('exit', (code, signal) => exit(signal ? 1 : code ?? 0));
  return undefined;
}

module.exports = { findChromeForTesting, executableIn, buildArgs, byVersionDesc, defaultCacheDir, main };

if (require.main === module) main();
