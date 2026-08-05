/**
 * Secrets and placeholders.
 *
 * `${NAME}` placeholders in an upstream's command/args/env resolve from the
 * overlay `.env` first, then process.env — so tokens never live in a tracked
 * config.json. `${NAME:-default}` takes the same lookups and falls back to the
 * literal default when they all miss, which is what lets a bundled upstream
 * carry an optional port without an `sh -c` wrapper around its command. Other
 * shell forms (`${VAR:+...}`) are not ours and pass through untouched. A
 * session env override is checked ahead of both lookups, so a per-session port
 * reaches the placeholder that names it.
 *
 * One reserved name: `${MCP_ROUTER_ROOT}` always resolves to this package's
 * root directory (checked BEFORE .env and process.env), which is how a
 * bundled upstream points at a launcher script it ships with.
 *
 * Spawn shapes also get their bare `node`/`npm`/`npx` command resolved to an
 * absolute path here, so a child comes up on machines where those names are
 * not on the router's own PATH.
 */

const fs = require('node:fs');
const path = require('node:path');

const { log } = require('./log.js');
const { PACKAGE_ROOT, envFile } = require('./paths.js');

const RESERVED = { MCP_ROUTER_ROOT: PACKAGE_ROOT };
const RESOLVABLE_BINS = new Set(['node', 'npm', 'npx']);

/**
 * Read the overlay .env into a plain object.
 *
 * @param {string} [file] - Path to read; defaults to the resolved env file
 * @returns {object} NAME → value (missing file is not an error — process.env may still answer)
 */
function loadEnvFile(file) {
  const secrets = {};
  let raw;
  try {
    raw = fs.readFileSync(file || envFile(), 'utf8');
  } catch {
    return secrets;
  }
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    secrets[match[1]] = value;
  }
  return secrets;
}

/**
 * Substitute `${NAME}` and `${NAME:-default}` placeholders in one string.
 *
 * @param {string} str - The raw command/arg/env value
 * @param {object} secrets - Values from the overlay .env
 * @param {object} [overrides] - Session env override; beats both ambient sources
 * @returns {string} The resolved string; a placeholder with no value and no default stays literal
 */
function interpolate(str, secrets, overrides = {}) {
  return String(str).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name, fallback) => {
    if (RESERVED[name] !== undefined) return RESERVED[name];
    if (overrides[name] !== undefined) return overrides[name];
    if (secrets[name] !== undefined) return secrets[name];
    if (process.env[name] !== undefined) return process.env[name];
    // A default IS a value — nothing is missing, so nothing is warned about.
    if (fallback !== undefined) return fallback;
    log('warn', `No value for placeholder ${whole} (expected in ${envFile()} or the environment); leaving literal`);
    return whole;
  });
}

/**
 * Resolve a bare `node`/`npm`/`npx` to the binary beside this process's own
 * node. process.execPath is the real, already-resolved node even when the
 * router was launched through a shell shim or from an nvm-only PATH, so its
 * siblings are reachable where the bare name is not — which is the difference
 * between a child that starts and a `Request timed out`.
 *
 * @param {string} cmd - The interpolated command from a registry entry
 * @returns {string} The absolute sibling when it exists; otherwise `cmd` untouched, to fall back to PATH
 */
function resolveBin(cmd) {
  if (cmd.includes('/') || cmd.includes('\\')) return cmd;
  if (!RESOLVABLE_BINS.has(cmd)) return cmd;
  if (cmd === 'node') return process.execPath;
  // win32 names these npx.cmd/npm.cmd on disk; probe rather than assume.
  const names = process.platform === 'win32' ? [`${cmd}.cmd`, cmd] : [cmd];
  for (const name of names) {
    const candidate = path.join(path.dirname(process.execPath), name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return cmd;
}

/**
 * Resolve an upstream's spawn shape. Re-reads .env on every call so a rotated
 * token is picked up without a router restart (spawns are rare, the read is
 * trivial).
 *
 * A session env override (`router__enable_upstream {env}`) feeds the same
 * placeholder resolution, ahead of .env and process.env: the override is what
 * the caller asked THIS child to run with, so a `${OMEGA_CDP_PORT:-9222}` in
 * the spawn shape has to see it — the values are baked here now, not expanded
 * later by a child shell.
 *
 * @param {object} upstream - A registry entry (`command`, `args`, `env`)
 * @param {object} [overrideEnv] - Session env override for placeholder resolution
 * @returns {{command: string, args: string[], env: object}} Interpolated spawn shape
 */
function resolveSpawn(upstream, overrideEnv = {}) {
  const secrets = loadEnvFile();
  return {
    command: resolveBin(interpolate(upstream.command, secrets, overrideEnv)),
    args: (upstream.args || []).map((arg) => interpolate(arg, secrets, overrideEnv)),
    env: Object.fromEntries(Object.entries(upstream.env || {}).map(([key, value]) => [key, interpolate(value, secrets, overrideEnv)])),
  };
}

module.exports = { loadEnvFile, interpolate, resolveBin, resolveSpawn, RESERVED };
