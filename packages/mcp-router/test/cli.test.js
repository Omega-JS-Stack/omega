/**
 * CLI tests — every command runs against fixture layer dirs, and the standing
 * assertion under all of them is the same one: the bundled dir is never
 * written. `refresh` spawns the real fixture MCP server, so the cached
 * schema it writes came off a genuine stdio handshake.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../src/cli.js');

const ECHO_SERVER = path.join(__dirname, 'fixtures', 'echo-server.js');

const BUNDLED = {
  // Commands point at scripts that do not exist — a refresh must fail fast and
  // locally, never resolve a name through the public npm registry.
  alpha: { enabled: true, command: 'node', args: [path.join(__dirname, 'fixtures', 'no-such-server.js')], tools: [{ name: 'go' }] },
  beta: { enabled: false, command: 'node', args: [path.join(__dirname, 'fixtures', 'no-such-server-either.js')], tools: [] },
};

/**
 * Fixture layers plus captured output.
 *
 * @returns {object} `{ bundledDir, overlayDir, out, err, lines, errors }`
 */
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-cli-'));
  const bundledDir = path.join(root, 'bundled');
  const overlayDir = path.join(root, 'overlay');
  for (const [name, config] of Object.entries(BUNDLED)) {
    fs.mkdirSync(path.join(bundledDir, name), { recursive: true });
    fs.writeFileSync(path.join(bundledDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  fs.mkdirSync(overlayDir, { recursive: true });

  const lines = [];
  const errors = [];
  return { bundledDir, overlayDir, lines, errors, out: (line) => lines.push(line), err: (line) => errors.push(line) };
}

const overlayOf = (context, name) => JSON.parse(fs.readFileSync(path.join(context.overlayDir, name, 'config.json'), 'utf8'));
const writeOverlay = (context, name, config) => {
  fs.mkdirSync(path.join(context.overlayDir, name), { recursive: true });
  fs.writeFileSync(path.join(context.overlayDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
};
const bundledOf = (context, name) => JSON.parse(fs.readFileSync(path.join(context.bundledDir, name, 'config.json'), 'utf8'));

module.exports = defineCases({
  type: 'group',
  description: 'cli',
  tests: [
    {
      name: 'disable writes {enabled: false} to the overlay and leaves the bundled default alone',
      run: async (ctx) => {
        const context = harness();
        ctx.expect(await run(['disable', 'alpha'], context)).toBe(0);
        ctx.expect(overlayOf(context, 'alpha')).toEqual({ enabled: false });
        ctx.expect(bundledOf(context, 'alpha')).toEqual(BUNDLED.alpha);
        ctx.expect(context.lines).toEqual(['Disabled alpha']);
      },
    },

    {
      name: 'enable flips the overlay back on and reports the refresh it could not do',
      run: async (ctx) => {
        const context = harness();
        await run(['disable', 'alpha'], context);
        ctx.expect(await run(['on', 'alpha'], context)).toBe(0);
        ctx.expect(overlayOf(context, 'alpha').enabled).toBe(true);
        ctx.expect(context.errors.join('\n')).toMatch(/could not cache schema for "alpha"/);
      },
    },

    {
      name: 'enable on an unknown upstream fails',
      run: async (ctx) => {
        const context = harness();
        ctx.expect(await run(['enable', 'ghost'], context)).toBe(1);
        ctx.expect(context.errors).toEqual(['Server "ghost" not found']);
        ctx.expect(fs.existsSync(path.join(context.overlayDir, 'ghost'))).toBe(false);
      },
    },

    {
      name: 'enable on a locked upstream refuses, names the field, and leaves the overlay alone',
      run: async (ctx) => {
        const context = harness();
        writeOverlay(context, 'alpha', { enabled: false, locked: true });
        ctx.expect(await run(['enable', 'alpha'], context)).toBe(1);
        ctx.expect(context.errors.join('\n')).toMatch(/"alpha" is locked \(locked: true/);
        ctx.expect(context.errors.join('\n')).toMatch(/omega-mcp enable alpha --force/);
        ctx.expect(overlayOf(context, 'alpha')).toEqual({ enabled: false, locked: true });
      },
    },

    {
      name: 'enable --force overrides the lock and the lock survives the flip',
      run: async (ctx) => {
        const context = harness();
        writeOverlay(context, 'alpha', { enabled: false, locked: true });
        ctx.expect(await run(['enable', 'alpha', '--force'], context)).toBe(0);
        ctx.expect(overlayOf(context, 'alpha')).toEqual({ enabled: true, locked: true });
        ctx.expect(context.lines[0]).toBe('Enabled alpha');
      },
    },

    {
      name: 'disable on a locked upstream is allowed',
      run: async (ctx) => {
        const context = harness();
        writeOverlay(context, 'alpha', { enabled: true, locked: true });
        ctx.expect(await run(['disable', 'alpha'], context)).toBe(0);
        ctx.expect(overlayOf(context, 'alpha')).toEqual({ enabled: false, locked: true });
      },
    },

    {
      name: 'remove on a locked private upstream is allowed',
      run: async (ctx) => {
        const context = harness();
        writeOverlay(context, 'mine', { enabled: false, locked: true, command: 'node', args: ['m.js'] });
        ctx.expect(await run(['rm', 'mine'], context)).toBe(0);
        ctx.expect(fs.existsSync(path.join(context.overlayDir, 'mine'))).toBe(false);
      },
    },

    {
      name: 'add over an existing locked entry refuses, so nothing writes enabled: true',
      run: async (ctx) => {
        const context = harness();
        writeOverlay(context, 'mine', { enabled: false, locked: true, command: 'node', args: ['m.js'] });
        ctx.expect(await run(['add', 'mine', 'node', ECHO_SERVER], context)).toBe(1);
        ctx.expect(context.errors.join('\n')).toMatch(/already exists/);
        ctx.expect(overlayOf(context, 'mine')).toEqual({ enabled: false, locked: true, command: 'node', args: ['m.js'] });
      },
    },

    {
      name: 'add writes a private upstream to the overlay and caches its real tool schema',
      run: async (ctx) => {
        const context = harness();
        ctx.expect(await run(['add', 'echo', 'node', ECHO_SERVER], context)).toBe(0);
        const entry = overlayOf(context, 'echo');
        ctx.expect(entry.enabled).toBe(true);
        ctx.expect(entry.command).toBe('node');
        ctx.expect(entry.args).toEqual([ECHO_SERVER]);
        ctx.expect(entry.tools.map((tool) => tool.name)).toEqual(['echo', 'ping']);
        ctx.expect(context.lines).toEqual(['Added echo', 'Cached 2 tool(s) for "echo"']);
      },
    },

    {
      name: 'add refuses a name either layer already knows',
      run: async (ctx) => {
        const context = harness();
        ctx.expect(await run(['add', 'alpha', 'node', ECHO_SERVER], context)).toBe(1);
        ctx.expect(context.errors.join('\n')).toMatch(/already exists/);
        ctx.expect(fs.existsSync(path.join(context.overlayDir, 'alpha'))).toBe(false);
      },
    },

    {
      name: 'add without a command prints usage',
      run: async (ctx) => {
        const context = harness();
        ctx.expect(await run(['add', 'echo'], context)).toBe(1);
        ctx.expect(context.errors[0]).toMatch(/Usage: omega-mcp add/);
      },
    },

    {
      name: 'refresh caches the tool list into the overlay',
      run: async (ctx) => {
        const context = harness();
        await run(['add', 'echo', 'node', ECHO_SERVER], context);
        ctx.expect(await run(['refresh', 'echo'], context)).toBe(0);
        ctx.expect(overlayOf(context, 'echo').tools.length).toBe(2);
      },
    },

    {
      name: 'refresh on an upstream that cannot start fails with the reason',
      run: async (ctx) => {
        const context = harness();
        await run(['add', 'broken', 'node', path.join(__dirname, 'fixtures', 'nope.js')], context);
        context.errors.length = 0;
        ctx.expect(await run(['refresh', 'broken'], context)).toBe(1);
        ctx.expect(context.errors[0]).toMatch(/^Refresh failed for "broken":/);
      },
    },

    {
      name: 'remove deletes a private upstream',
      run: async (ctx) => {
        const context = harness();
        await run(['add', 'echo', 'node', ECHO_SERVER], context);
        ctx.expect(await run(['rm', 'echo'], context)).toBe(0);
        ctx.expect(fs.existsSync(path.join(context.overlayDir, 'echo'))).toBe(false);
        ctx.expect(context.lines.at(-1)).toBe('Removed echo');
      },
    },

    {
      name: 'remove on a bundled default refuses and points at disable',
      run: async (ctx) => {
        const context = harness();
        ctx.expect(await run(['remove', 'alpha'], context)).toBe(1);
        ctx.expect(context.errors[0]).toMatch(/bundled default and cannot be removed.*omega-mcp disable alpha/);
        ctx.expect(bundledOf(context, 'alpha')).toEqual(BUNDLED.alpha);
      },
    },

    {
      name: 'remove on a bundled default that has overrides drops only the overrides',
      run: async (ctx) => {
        const context = harness();
        await run(['disable', 'alpha'], context);
        ctx.expect(await run(['remove', 'alpha'], context)).toBe(0);
        ctx.expect(context.lines.at(-1)).toMatch(/the bundled default is back in effect/);
        ctx.expect(fs.existsSync(path.join(context.overlayDir, 'alpha'))).toBe(false);
      },
    },

    {
      name: 'list shows every layer with its source and state',
      run: async (ctx) => {
        const context = harness();
        await run(['add', 'echo', 'node', ECHO_SERVER], context);
        await run(['disable', 'beta'], context);
        context.lines.length = 0;
        ctx.expect(await run(['ls'], context)).toBe(0);

        const listed = context.lines.join('\n');
        ctx.expect(listed).toMatch(/alpha \(bundled\) \(1 tools cached\)/);
        ctx.expect(listed).toMatch(/beta \(bundled, overridden\) \(no cache\)/);
        ctx.expect(listed).toMatch(/echo \(yours\) \(2 tools cached\)/);
      },
    },

    {
      name: 'list marks a locked upstream',
      run: async (ctx) => {
        const context = harness();
        writeOverlay(context, 'alpha', { enabled: false, locked: true });
        ctx.expect(await run(['ls'], context)).toBe(0);
        ctx.expect(context.lines.join('\n')).toMatch(/alpha \[locked\] \(bundled, overridden\)/);
      },
    },

    {
      name: 'help is the no-command default and names the CLI',
      run: async (ctx) => {
        const context = harness();
        ctx.expect(await run([], context)).toBe(0);
        ctx.expect(context.lines[0]).toMatch(/Usage: omega-mcp <command>/);
      },
    },

    {
      name: 'an unknown command exits 1',
      run: async (ctx) => {
        const context = harness();
        ctx.expect(await run(['sync'], context)).toBe(1);
        ctx.expect(context.errors[0]).toMatch(/Unknown command: sync/);
      },
    },
  ],
});
