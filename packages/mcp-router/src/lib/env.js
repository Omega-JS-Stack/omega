/**
 * Secrets and placeholders.
 *
 * `${NAME}` placeholders in an upstream's command/args/env resolve from the
 * overlay `.env` first, then process.env — so tokens never live in a tracked
 * config.json. ONLY the strict `${NAME}` form is interpolated: shell forms
 * like `${VAR:-default}` / `${VAR:+...}` inside an `sh -c` string pass through
 * untouched for the shell to expand at spawn time.
 *
 * One reserved name: `${MCP_ROUTER_ROOT}` always resolves to this package's
 * root directory (checked BEFORE .env and process.env), which is how a
 * bundled upstream points at a launcher script it ships with.
 */

const fs = require('node:fs');

const { log } = require('./log.js');
const { PACKAGE_ROOT, envFile } = require('./paths.js');

const RESERVED = { MCP_ROUTER_ROOT: PACKAGE_ROOT };

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
 * Substitute strict `${NAME}` placeholders in one string.
 *
 * @param {string} str - The raw command/arg/env value
 * @param {object} secrets - Values from the overlay .env
 * @returns {string} The resolved string; an unresolvable placeholder stays literal
 */
function interpolate(str, secrets) {
  return String(str).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => {
    if (RESERVED[name] !== undefined) return RESERVED[name];
    if (secrets[name] !== undefined) return secrets[name];
    if (process.env[name] !== undefined) return process.env[name];
    log('warn', `No value for placeholder ${whole} (expected in ${envFile()} or the environment); leaving literal`);
    return whole;
  });
}

/**
 * Resolve an upstream's spawn shape. Re-reads .env on every call so a rotated
 * token is picked up without a router restart (spawns are rare, the read is
 * trivial).
 *
 * @param {object} upstream - A registry entry (`command`, `args`, `env`)
 * @returns {{command: string, args: string[], env: object}} Interpolated spawn shape
 */
function resolveSpawn(upstream) {
  const secrets = loadEnvFile();
  return {
    command: interpolate(upstream.command, secrets),
    args: (upstream.args || []).map((arg) => interpolate(arg, secrets)),
    env: Object.fromEntries(Object.entries(upstream.env || {}).map(([key, value]) => [key, interpolate(value, secrets)])),
  };
}

module.exports = { loadEnvFile, interpolate, resolveSpawn, RESERVED };
