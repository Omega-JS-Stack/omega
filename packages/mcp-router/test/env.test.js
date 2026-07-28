/**
 * Env tests — interpolation is a security surface (tokens live in the overlay
 * .env, never in a config) AND a correctness surface: the strict-form-only
 * rule is what lets an `sh -c` upstream keep its own `${VAR:-default}`.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadEnvFile, interpolate, resolveSpawn } = require('../src/lib/env.js');
const { PACKAGE_ROOT } = require('../src/lib/paths.js');

/**
 * Write a fixture .env and point the env seam at it.
 *
 * @param {object} t - The node:test context, for cleanup
 * @param {string} body - The file contents
 * @returns {string} The file path
 */
function envFixture(t, body) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-env-')), '.env');
  fs.writeFileSync(file, body);
  const previous = process.env.MCP_ROUTER_ENV_FILE;
  process.env.MCP_ROUTER_ENV_FILE = file;
  t.after(() => {
    if (previous === undefined) delete process.env.MCP_ROUTER_ENV_FILE;
    else process.env.MCP_ROUTER_ENV_FILE = previous;
  });
  return file;
}

test('.env parsing takes plain, quoted, and spaced forms and ignores the rest', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-env-')), '.env');
  fs.writeFileSync(file, '# a comment\nPLAIN=one\nQUOTED="two"\nSINGLE=\'three\'\n SPACED = four \n\nnot a line\n');
  assert.deepEqual(loadEnvFile(file), { PLAIN: 'one', QUOTED: 'two', SINGLE: 'three', SPACED: 'four' });
});

test('a missing .env is not an error — process.env may still answer', () => {
  assert.deepEqual(loadEnvFile(path.join(os.tmpdir(), 'mcp-router-nope', '.env')), {});
});

test('${NAME} resolves from .env first, then process.env', (t) => {
  t.after(() => { delete process.env.MCP_ROUTER_TEST_SHELL_ONLY; });
  process.env.MCP_ROUTER_TEST_SHELL_ONLY = 'from-shell';
  const secrets = { SECRET_TOKEN: 'from-dotenv' };
  assert.equal(interpolate('--token=${SECRET_TOKEN}', secrets), '--token=from-dotenv');
  assert.equal(interpolate('--x=${MCP_ROUTER_TEST_SHELL_ONLY}', secrets), '--x=from-shell');
});

test('an unresolvable ${NAME} stays literal rather than becoming an empty string', () => {
  assert.equal(interpolate('--token=${NOBODY_DEFINES_THIS}', {}), '--token=${NOBODY_DEFINES_THIS}');
});

test('shell forms pass through untouched for the shell to expand', () => {
  const shell = 'exec npx -y chrome-devtools-mcp@1.4.0 --browserUrl=http://127.0.0.1:${OMEGA_CDP_PORT:-9222}';
  assert.equal(interpolate(shell, { OMEGA_CDP_PORT: '4000' }), shell);
  assert.equal(interpolate('${VAR:+--flag}', { VAR: 'x' }), '${VAR:+--flag}');
});

test('${MCP_ROUTER_ROOT} is reserved and wins over .env and process.env', (t) => {
  t.after(() => { delete process.env.MCP_ROUTER_ROOT; });
  process.env.MCP_ROUTER_ROOT = '/hijacked';
  assert.equal(interpolate('${MCP_ROUTER_ROOT}/src/launch-cft.js', { MCP_ROUTER_ROOT: '/also-hijacked' }), `${PACKAGE_ROOT}/src/launch-cft.js`);
});

test('resolveSpawn interpolates command, args, and env from the overlay .env', (t) => {
  envFixture(t, 'TOKEN=sekret\n');
  const spawn = resolveSpawn({
    command: 'node',
    args: ['${MCP_ROUTER_ROOT}/src/launch-cft.js', '--token=${TOKEN}'],
    env: { API_KEY: '${TOKEN}' },
  });
  assert.equal(spawn.command, 'node');
  assert.deepEqual(spawn.args, [path.join(PACKAGE_ROOT, 'src', 'launch-cft.js'), '--token=sekret']);
  assert.deepEqual(spawn.env, { API_KEY: 'sekret' });
});

test('resolveSpawn tolerates an upstream with no args or env', () => {
  assert.deepEqual(resolveSpawn({ command: 'node' }), { command: 'node', args: [], env: {} });
});
