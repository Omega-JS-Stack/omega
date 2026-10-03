/**
 * Env tests — interpolation is a security surface (tokens live in the overlay
 * .env, never in a config) AND a correctness surface: `${NAME:-default}` is
 * what lets a bundled upstream carry an optional port without wrapping its
 * command in a shell.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadEnvFile, interpolate, resolveBin, resolveSpawn } = require('../src/lib/env.js');
const { PACKAGE_ROOT } = require('../src/lib/paths.js');

/**
 * Write a fixture .env and point the env seam at it.
 *
 * @param {object} t - The case's ctx, for cleanup
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

module.exports = defineCases({
  type: 'group',
  description: 'env',
  tests: [
    {
      name: '.env parsing takes plain, quoted, and spaced forms and ignores the rest',
      run: (ctx) => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-env-')), '.env');
        fs.writeFileSync(file, '# a comment\nPLAIN=one\nQUOTED="two"\nSINGLE=\'three\'\n SPACED = four \n\nnot a line\n');
        ctx.expect(loadEnvFile(file)).toEqual({ PLAIN: 'one', QUOTED: 'two', SINGLE: 'three', SPACED: 'four' });
      },
    },

    {
      name: 'a double-quoted value takes its escapes, and a trailing comment is not part of the value',
      run: (ctx) => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-env-')), '.env');
        fs.writeFileSync(file, 'ESCAPED="line1\\nline2"\nCOMMENTED="token" # rotated 2026-08-21\nexport EXPORTED="from-a-sourced-file"\n');
        ctx.expect(loadEnvFile(file)).toEqual({ ESCAPED: 'line1\nline2', COMMENTED: 'token', EXPORTED: 'from-a-sourced-file' });
      },
    },

    {
      name: 'a missing .env is not an error — process.env may still answer',
      run: (ctx) => {
        ctx.expect(loadEnvFile(path.join(os.tmpdir(), 'mcp-router-nope', '.env'))).toEqual({});
      },
    },

    {
      name: '${NAME} resolves from .env first, then process.env',
      run: (ctx) => {
        ctx.after(() => { delete process.env.MCP_ROUTER_TEST_SHELL_ONLY; });
        process.env.MCP_ROUTER_TEST_SHELL_ONLY = 'from-shell';
        const secrets = { SECRET_TOKEN: 'from-dotenv' };
        ctx.expect(interpolate('--token=${SECRET_TOKEN}', secrets)).toBe('--token=from-dotenv');
        ctx.expect(interpolate('--x=${MCP_ROUTER_TEST_SHELL_ONLY}', secrets)).toBe('--x=from-shell');
      },
    },

    {
      name: 'an unresolvable ${NAME} stays literal rather than becoming an empty string',
      run: (ctx) => {
        ctx.expect(interpolate('--token=${NOBODY_DEFINES_THIS}', {})).toBe('--token=${NOBODY_DEFINES_THIS}');
      },
    },

    {
      name: '${NAME:-default} takes a set value over its default, from .env or process.env',
      run: (ctx) => {
        ctx.after(() => { delete process.env.MCP_ROUTER_TEST_SHELL_ONLY; });
        process.env.MCP_ROUTER_TEST_SHELL_ONLY = 'from-shell';
        ctx.expect(interpolate('--url=http://127.0.0.1:${OMEGA_CDP_PORT:-9222}', { OMEGA_CDP_PORT: '4000' })).toBe('--url=http://127.0.0.1:4000');
        ctx.expect(interpolate('--x=${MCP_ROUTER_TEST_SHELL_ONLY:-fallback}', {})).toBe('--x=from-shell');
      },
    },

    {
      name: '${NAME:-default} falls back to the literal default when nothing defines it',
      run: (ctx) => {
        ctx.expect(interpolate('--url=http://127.0.0.1:${OMEGA_CDP_PORT_NOBODY_SETS:-9222}', {})).toBe('--url=http://127.0.0.1:9222');
        ctx.expect(interpolate('--x=${NOBODY_DEFINES_THIS:-}', {})).toBe('--x=');
      },
    },

    {
      name: 'a reserved name still wins over a default',
      run: (ctx) => {
        ctx.expect(interpolate('${MCP_ROUTER_ROOT:-/nope}/src/launch-cft.js', {})).toBe(`${PACKAGE_ROOT}/src/launch-cft.js`);
      },
    },

    {
      name: 'other shell forms are not ours and pass through untouched',
      run: (ctx) => {
        ctx.expect(interpolate('${VAR:+--flag}', { VAR: 'x' })).toBe('${VAR:+--flag}');
      },
    },

    {
      name: '${MCP_ROUTER_ROOT} is reserved and wins over .env and process.env',
      run: (ctx) => {
        ctx.after(() => { delete process.env.MCP_ROUTER_ROOT; });
        process.env.MCP_ROUTER_ROOT = '/hijacked';
        ctx.expect(interpolate('${MCP_ROUTER_ROOT}/src/launch-cft.js', { MCP_ROUTER_ROOT: '/also-hijacked' })).toBe(`${PACKAGE_ROOT}/src/launch-cft.js`);
      },
    },

    {
      name: 'resolveSpawn interpolates command, args, and env from the overlay .env',
      run: (ctx) => {
        envFixture(ctx, 'TOKEN=sekret\n');
        const spawn = resolveSpawn({
          command: 'node',
          args: ['${MCP_ROUTER_ROOT}/src/launch-cft.js', '--token=${TOKEN}'],
          env: { API_KEY: '${TOKEN}' },
        });
        ctx.expect(spawn.command).toBe(process.execPath);
        ctx.expect(spawn.args).toEqual([path.join(PACKAGE_ROOT, 'src', 'launch-cft.js'), '--token=sekret']);
        ctx.expect(spawn.env).toEqual({ API_KEY: 'sekret' });
      },
    },

    {
      name: 'a session env override reaches the placeholder that names it, and the default answers without one',
      run: (ctx) => {
        // The .env carries the port too: the override has to beat the ambient
        // sources, which is the precedence the child shell used to give it.
        envFixture(ctx, 'OMEGA_CDP_PORT=9500\n');
        const upstream = { command: 'node', args: ['--url=http://127.0.0.1:${OMEGA_CDP_PORT:-9222}'] };
        ctx.expect(resolveSpawn(upstream, { OMEGA_CDP_PORT: '9333' }).args).toEqual(['--url=http://127.0.0.1:9333']);
        ctx.expect(resolveSpawn(upstream).args).toEqual(['--url=http://127.0.0.1:9500']);

        const bare = { command: 'node', args: ['--url=http://127.0.0.1:${OMEGA_CDP_PORT_NOBODY_SETS:-9222}'] };
        ctx.expect(resolveSpawn(bare).args).toEqual(['--url=http://127.0.0.1:9222']);
      },
    },

    {
      name: 'resolveSpawn tolerates an upstream with no args or env',
      run: (ctx) => {
        ctx.expect(resolveSpawn({ command: 'node' })).toEqual({ command: process.execPath, args: [], env: {} });
      },
    },

    {
      name: 'a bare npx upstream spawns the absolute npx beside this node, not a PATH lookup',
      run: (ctx) => {
        // The same probe the resolver runs: no sibling npx on this machine means the
        // bare name (the PATH fallback) IS the correct answer, not a failure.
        const sibling = ['npx.cmd', 'npx']
          .map((name) => path.join(path.dirname(process.execPath), name))
          .find((candidate) => fs.existsSync(candidate));

        const spawn = resolveSpawn({ command: 'npx', args: ['-y', 'chrome-devtools-mcp@1.4.0'] });
        if (sibling) {
          ctx.expect(path.isAbsolute(spawn.command), `expected an absolute command, got ${spawn.command}`).toBeTruthy();
          ctx.expect(path.basename(spawn.command)).toMatch(/^npx(\.cmd)?$/);
          ctx.expect(path.dirname(spawn.command)).toBe(path.dirname(process.execPath));
        } else {
          ctx.expect(spawn.command).toBe('npx');
        }
        ctx.expect(spawn.args).toEqual(['-y', 'chrome-devtools-mcp@1.4.0']);
      },
    },

    {
      name: 'bare node resolves to this process own binary',
      run: (ctx) => {
        ctx.expect(resolveBin('node')).toBe(process.execPath);
      },
    },

    {
      name: 'a command that is already a path is never touched',
      run: (ctx) => {
        ctx.expect(resolveBin('/usr/local/bin/node')).toBe('/usr/local/bin/node');
        ctx.expect(resolveBin('./scripts/npx')).toBe('./scripts/npx');
      },
    },

    {
      name: 'an unknown bare command keeps its PATH lookup',
      run: (ctx) => {
        ctx.expect(resolveBin('docker')).toBe('docker');
        ctx.expect(resolveBin('uvx')).toBe('uvx');
      },
    },
  ],
});
