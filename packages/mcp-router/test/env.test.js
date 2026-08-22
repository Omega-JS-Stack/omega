/**
 * Env tests — interpolation is a security surface (tokens live in the overlay
 * .env, never in a config) AND a correctness surface: `${NAME:-default}` is
 * what lets a bundled upstream carry an optional port without wrapping its
 * command in a shell.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadEnvFile, interpolate, resolveBin, resolveSpawn } = require('../src/lib/env.js');
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

test('a double-quoted value takes its escapes, and a trailing comment is not part of the value', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-env-')), '.env');
  fs.writeFileSync(file, 'ESCAPED="line1\\nline2"\nCOMMENTED="token" # rotated 2026-08-21\nexport EXPORTED="from-a-sourced-file"\n');
  assert.deepEqual(loadEnvFile(file), { ESCAPED: 'line1\nline2', COMMENTED: 'token', EXPORTED: 'from-a-sourced-file' });
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

test('${NAME:-default} takes a set value over its default, from .env or process.env', (t) => {
  t.after(() => { delete process.env.MCP_ROUTER_TEST_SHELL_ONLY; });
  process.env.MCP_ROUTER_TEST_SHELL_ONLY = 'from-shell';
  assert.equal(interpolate('--url=http://127.0.0.1:${OMEGA_CDP_PORT:-9222}', { OMEGA_CDP_PORT: '4000' }), '--url=http://127.0.0.1:4000');
  assert.equal(interpolate('--x=${MCP_ROUTER_TEST_SHELL_ONLY:-fallback}', {}), '--x=from-shell');
});

test('${NAME:-default} falls back to the literal default when nothing defines it', () => {
  assert.equal(interpolate('--url=http://127.0.0.1:${OMEGA_CDP_PORT_NOBODY_SETS:-9222}', {}), '--url=http://127.0.0.1:9222');
  assert.equal(interpolate('--x=${NOBODY_DEFINES_THIS:-}', {}), '--x=');
});

test('a reserved name still wins over a default', () => {
  assert.equal(interpolate('${MCP_ROUTER_ROOT:-/nope}/src/launch-cft.js', {}), `${PACKAGE_ROOT}/src/launch-cft.js`);
});

test('other shell forms are not ours and pass through untouched', () => {
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
  assert.equal(spawn.command, process.execPath);
  assert.deepEqual(spawn.args, [path.join(PACKAGE_ROOT, 'src', 'launch-cft.js'), '--token=sekret']);
  assert.deepEqual(spawn.env, { API_KEY: 'sekret' });
});

test('a session env override reaches the placeholder that names it, and the default answers without one', (t) => {
  // The .env carries the port too: the override has to beat the ambient
  // sources, which is the precedence the child shell used to give it.
  envFixture(t, 'OMEGA_CDP_PORT=9500\n');
  const upstream = { command: 'node', args: ['--url=http://127.0.0.1:${OMEGA_CDP_PORT:-9222}'] };
  assert.deepEqual(resolveSpawn(upstream, { OMEGA_CDP_PORT: '9333' }).args, ['--url=http://127.0.0.1:9333']);
  assert.deepEqual(resolveSpawn(upstream).args, ['--url=http://127.0.0.1:9500']);

  const bare = { command: 'node', args: ['--url=http://127.0.0.1:${OMEGA_CDP_PORT_NOBODY_SETS:-9222}'] };
  assert.deepEqual(resolveSpawn(bare).args, ['--url=http://127.0.0.1:9222']);
});

test('resolveSpawn tolerates an upstream with no args or env', () => {
  assert.deepEqual(resolveSpawn({ command: 'node' }), { command: process.execPath, args: [], env: {} });
});

test('a bare npx upstream spawns the absolute npx beside this node, not a PATH lookup', () => {
  // The same probe the resolver runs: no sibling npx on this machine means the
  // bare name (the PATH fallback) IS the correct answer, not a failure.
  const sibling = ['npx.cmd', 'npx']
    .map((name) => path.join(path.dirname(process.execPath), name))
    .find((candidate) => fs.existsSync(candidate));

  const spawn = resolveSpawn({ command: 'npx', args: ['-y', 'chrome-devtools-mcp@1.4.0'] });
  if (sibling) {
    assert.ok(path.isAbsolute(spawn.command), `expected an absolute command, got ${spawn.command}`);
    assert.match(path.basename(spawn.command), /^npx(\.cmd)?$/);
    assert.equal(path.dirname(spawn.command), path.dirname(process.execPath));
  } else {
    assert.equal(spawn.command, 'npx');
  }
  assert.deepEqual(spawn.args, ['-y', 'chrome-devtools-mcp@1.4.0']);
});

test('bare node resolves to this process own binary', () => {
  assert.equal(resolveBin('node'), process.execPath);
});

test('a command that is already a path is never touched', () => {
  assert.equal(resolveBin('/usr/local/bin/node'), '/usr/local/bin/node');
  assert.equal(resolveBin('./scripts/npx'), './scripts/npx');
});

test('an unknown bare command keeps its PATH lookup', () => {
  assert.equal(resolveBin('docker'), 'docker');
  assert.equal(resolveBin('uvx'), 'uvx');
});
