/**
 * Registry tests — the layering contract is the whole point of the package:
 * bundled defaults a consumer must never edit, an overlay that shadows them
 * field by field, and writes that land in the overlay only.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('../src/lib/registry.js');

/**
 * Build a pair of layer dirs from plain objects.
 *
 * @param {object} bundled - name → config (or a raw string to write verbatim)
 * @param {object} overlay - name → config (or a raw string to write verbatim)
 * @returns {{bundledDir: string, overlayDir: string}} The layer options
 */
function fixture(bundled = {}, overlay = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-registry-'));
  const dirs = {};
  for (const [layer, entries] of Object.entries({ bundled, overlay })) {
    const dir = path.join(root, layer);
    for (const [name, config] of Object.entries(entries)) {
      fs.mkdirSync(path.join(dir, name), { recursive: true });
      const body = typeof config === 'string' ? config : `${JSON.stringify(config, null, 2)}\n`;
      fs.writeFileSync(path.join(dir, name, 'config.json'), body);
    }
    fs.mkdirSync(dir, { recursive: true });
    dirs[`${layer}Dir`] = dir;
  }
  return dirs;
}

const DEFAULT = { enabled: true, command: 'npx', args: ['-y', 'thing'], tools: [{ name: 'go' }] };

module.exports = defineCases({
  type: 'group',
  description: 'registry',
  tests: [
    {
      name: 'a bundled-only upstream loads with its defaults',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT });
        const alpha = registry.loadUpstreams(layers).alpha;
        ctx.expect(alpha.enabled_on_disk).toBe(true);
        ctx.expect(alpha.default).toBe('auto');
        ctx.expect(alpha.args).toEqual(['-y', 'thing']);
        ctx.expect(alpha.bundled).toBe(true);
        ctx.expect(alpha.overlaid).toBe(false);
      },
    },

    {
      name: 'an overlay-only upstream adds a private upstream',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT }, { beta: { enabled: true, command: 'node', args: ['b.js'] } });
        const upstreams = registry.loadUpstreams(layers);
        ctx.expect(Object.keys(upstreams)).toEqual(['alpha', 'beta']);
        ctx.expect(upstreams.beta.bundled).toBe(false);
        ctx.expect(upstreams.beta.overlaid).toBe(true);
        ctx.expect(upstreams.beta.tools).toEqual([]);
      },
    },

    {
      name: 'the merge is shallow and field-level: overlay keys win, the rest survive',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT }, { alpha: { args: ['-y', 'other'] } });
        const alpha = registry.loadUpstream('alpha', layers);
        ctx.expect(alpha.args).toEqual(['-y', 'other']);
        ctx.expect(alpha.command, 'the bundled command must survive an args-only overlay').toBe('npx');
        ctx.expect(alpha.tools.length, 'the bundled tools cache must survive an args-only overlay').toBe(1);
        ctx.expect(alpha.bundled).toBe(true);
        ctx.expect(alpha.overlaid).toBe(true);
      },
    },

    {
      name: '{"enabled": false} alone turns a bundled default off',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT }, { alpha: { enabled: false } });
        const alpha = registry.loadUpstream('alpha', layers);
        ctx.expect(alpha.enabled_on_disk).toBe(false);
        ctx.expect(alpha.command).toBe('npx');
      },
    },

    {
      name: '{"locked": true} surfaces on the entry and defaults to false',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT }, { alpha: { enabled: false, locked: true }, beta: DEFAULT });
        ctx.expect(registry.loadUpstream('alpha', layers).locked).toBe(true);
        ctx.expect(registry.loadUpstream('beta', layers).locked).toBe(false);
      },
    },

    {
      name: 'the locked refusal names the field and the escape hatch',
      run: (ctx) => {
        const message = registry.lockedRefusal('alpha');
        ctx.expect(message).toMatch(/"alpha" is locked/);
        ctx.expect(message).toMatch(/locked: true/);
        ctx.expect(message).toMatch(/omega-mcp enable alpha --force/);
      },
    },

    {
      name: 'a malformed overlay config is skipped loudly and the rest of the registry survives',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT, gamma: DEFAULT }, { alpha: '{ not json' });
        const upstreams = registry.loadUpstreams(layers);
        ctx.expect(Object.keys(upstreams)).toEqual(['alpha', 'gamma']);
        ctx.expect(upstreams.alpha.command, 'the bundled layer answers when the overlay is unreadable').toBe('npx');
      },
    },

    {
      name: 'a malformed bundled config with no overlay drops that upstream, not the registry',
      run: (ctx) => {
        const layers = fixture({ alpha: '{ not json', gamma: DEFAULT });
        ctx.expect(Object.keys(registry.loadUpstreams(layers))).toEqual(['gamma']);
      },
    },

    {
      name: 'an unknown name resolves to null',
      run: (ctx) => {
        ctx.expect(registry.loadUpstream('ghost', fixture({ alpha: DEFAULT }))).toBe(null);
      },
    },

    {
      name: 'writes land in the overlay only, merged into what is already there',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT });
        registry.patchOverlayEntry('alpha', { enabled: false }, layers);
        registry.patchOverlayEntry('alpha', { tools: [{ name: 'fresh' }] }, layers);

        const bundled = JSON.parse(fs.readFileSync(path.join(layers.bundledDir, 'alpha', 'config.json'), 'utf8'));
        ctx.expect(bundled, 'the bundled config must be untouched').toEqual(DEFAULT);

        ctx.expect(registry.readOverlayEntry('alpha', layers)).toEqual({ enabled: false, tools: [{ name: 'fresh' }] });
        const merged = registry.loadUpstream('alpha', layers);
        ctx.expect(merged.command).toBe('npx');
        ctx.expect(merged.enabled_on_disk).toBe(false);
        ctx.expect(merged.tools).toEqual([{ name: 'fresh' }]);
      },
    },

    {
      name: 'removing an overlay entry restores the bundled default',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT }, { alpha: { enabled: false } });
        ctx.expect(registry.removeOverlayEntry('alpha', layers)).toBe(true);
        ctx.expect(registry.loadUpstream('alpha', layers).enabled_on_disk).toBe(true);
        ctx.expect(registry.removeOverlayEntry('alpha', layers), 'removing twice is not an error').toBe(false);
      },
    },

    {
      name: 'isBundled distinguishes a shipped default from a private upstream',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT }, { beta: DEFAULT });
        ctx.expect(registry.isBundled('alpha', layers)).toBe(true);
        ctx.expect(registry.isBundled('beta', layers)).toBe(false);
      },
    },

    {
      name: 'a missing layer directory is normal, not an error',
      run: (ctx) => {
        const layers = fixture({ alpha: DEFAULT });
        fs.rmSync(layers.overlayDir, { recursive: true });
        ctx.expect(Object.keys(registry.loadUpstreams(layers))).toEqual(['alpha']);
      },
    },

    {
      name: 'the default layers are the package servers dir and the overlay env seam',
      run: (ctx) => {
        ctx.after(() => { delete process.env.MCP_ROUTER_SERVERS_DIR; });
        process.env.MCP_ROUTER_SERVERS_DIR = '/tmp/some-overlay';
        const layers = registry.layers();
        ctx.expect(layers.bundledDir).toBe(path.join(__dirname, '..', 'servers'));
        ctx.expect(layers.overlayDir).toBe('/tmp/some-overlay');
      },
    },
  ],
});
