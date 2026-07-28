/**
 * Registry tests — the layering contract is the whole point of the package:
 * bundled defaults a consumer must never edit, an overlay that shadows them
 * field by field, and writes that land in the overlay only.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('a bundled-only upstream loads with its defaults', () => {
  const layers = fixture({ alpha: DEFAULT });
  const alpha = registry.loadUpstreams(layers).alpha;
  assert.equal(alpha.enabled_on_disk, true);
  assert.equal(alpha.default, 'auto');
  assert.deepEqual(alpha.args, ['-y', 'thing']);
  assert.equal(alpha.bundled, true);
  assert.equal(alpha.overlaid, false);
});

test('an overlay-only upstream adds a private upstream', () => {
  const layers = fixture({ alpha: DEFAULT }, { beta: { enabled: true, command: 'node', args: ['b.js'] } });
  const upstreams = registry.loadUpstreams(layers);
  assert.deepEqual(Object.keys(upstreams), ['alpha', 'beta']);
  assert.equal(upstreams.beta.bundled, false);
  assert.equal(upstreams.beta.overlaid, true);
  assert.deepEqual(upstreams.beta.tools, []);
});

test('the merge is shallow and field-level: overlay keys win, the rest survive', () => {
  const layers = fixture({ alpha: DEFAULT }, { alpha: { args: ['-y', 'other'] } });
  const alpha = registry.loadUpstream('alpha', layers);
  assert.deepEqual(alpha.args, ['-y', 'other']);
  assert.equal(alpha.command, 'npx', 'the bundled command must survive an args-only overlay');
  assert.equal(alpha.tools.length, 1, 'the bundled tools cache must survive an args-only overlay');
  assert.equal(alpha.bundled, true);
  assert.equal(alpha.overlaid, true);
});

test('{"enabled": false} alone turns a bundled default off', () => {
  const layers = fixture({ alpha: DEFAULT }, { alpha: { enabled: false } });
  const alpha = registry.loadUpstream('alpha', layers);
  assert.equal(alpha.enabled_on_disk, false);
  assert.equal(alpha.command, 'npx');
});

test('a malformed overlay config is skipped loudly and the rest of the registry survives', () => {
  const layers = fixture({ alpha: DEFAULT, gamma: DEFAULT }, { alpha: '{ not json' });
  const upstreams = registry.loadUpstreams(layers);
  assert.deepEqual(Object.keys(upstreams), ['alpha', 'gamma']);
  assert.equal(upstreams.alpha.command, 'npx', 'the bundled layer answers when the overlay is unreadable');
});

test('a malformed bundled config with no overlay drops that upstream, not the registry', () => {
  const layers = fixture({ alpha: '{ not json', gamma: DEFAULT });
  assert.deepEqual(Object.keys(registry.loadUpstreams(layers)), ['gamma']);
});

test('an unknown name resolves to null', () => {
  assert.equal(registry.loadUpstream('ghost', fixture({ alpha: DEFAULT })), null);
});

test('writes land in the overlay only, merged into what is already there', () => {
  const layers = fixture({ alpha: DEFAULT });
  registry.patchOverlayEntry('alpha', { enabled: false }, layers);
  registry.patchOverlayEntry('alpha', { tools: [{ name: 'fresh' }] }, layers);

  const bundled = JSON.parse(fs.readFileSync(path.join(layers.bundledDir, 'alpha', 'config.json'), 'utf8'));
  assert.deepEqual(bundled, DEFAULT, 'the bundled config must be untouched');

  assert.deepEqual(registry.readOverlayEntry('alpha', layers), { enabled: false, tools: [{ name: 'fresh' }] });
  const merged = registry.loadUpstream('alpha', layers);
  assert.equal(merged.command, 'npx');
  assert.equal(merged.enabled_on_disk, false);
  assert.deepEqual(merged.tools, [{ name: 'fresh' }]);
});

test('removing an overlay entry restores the bundled default', () => {
  const layers = fixture({ alpha: DEFAULT }, { alpha: { enabled: false } });
  assert.equal(registry.removeOverlayEntry('alpha', layers), true);
  assert.equal(registry.loadUpstream('alpha', layers).enabled_on_disk, true);
  assert.equal(registry.removeOverlayEntry('alpha', layers), false, 'removing twice is not an error');
});

test('isBundled distinguishes a shipped default from a private upstream', () => {
  const layers = fixture({ alpha: DEFAULT }, { beta: DEFAULT });
  assert.equal(registry.isBundled('alpha', layers), true);
  assert.equal(registry.isBundled('beta', layers), false);
});

test('a missing layer directory is normal, not an error', () => {
  const layers = fixture({ alpha: DEFAULT });
  fs.rmSync(layers.overlayDir, { recursive: true });
  assert.deepEqual(Object.keys(registry.loadUpstreams(layers)), ['alpha']);
});

test('the default layers are the package servers dir and the overlay env seam', (t) => {
  t.after(() => { delete process.env.MCP_ROUTER_SERVERS_DIR; });
  process.env.MCP_ROUTER_SERVERS_DIR = '/tmp/some-overlay';
  const layers = registry.layers();
  assert.equal(layers.bundledDir, path.join(__dirname, '..', 'servers'));
  assert.equal(layers.overlayDir, '/tmp/some-overlay');
});
