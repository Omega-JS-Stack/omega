/**
 * layouts.js — layered layout DELIVERY, both modes, with ZERO file copying:
 * `virtual` registers each winner as an Eleventy virtual template under
 * `_includes/<rel>` (build), and `farm` composes a symlink farm (dev — the
 * only watchable form, since virtual template content is captured at config
 * time). The farm is rebuilt from scratch on every call, so a layout deleted
 * upstream must not survive as a stale link.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { registerVirtualLayouts, composeSymlinkFarm } = require('../src/layouts.js');

// Build a fixture tree ({ 'relative/path': contents }) and return its root.
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-layouts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

// The one method of the Eleventy config surface this module touches.
function recordingConfig() {
  const templates = [];
  return { templates, addTemplate: (name, content) => templates.push([name, content]) };
}

test('virtual mode registers every winner under _includes/, content and all', (t) => {
  const root = fixture(t, {
    'active/blueprint/index.liquid': 'ACTIVE INDEX',
    'core/default.liquid': 'CORE DEFAULT',
  });
  const config = recordingConfig();

  registerVirtualLayouts(config, new Map([
    [path.join('blueprint', 'index.liquid'), path.join(root, 'active', 'blueprint', 'index.liquid')],
    ['default.liquid', path.join(root, 'core', 'default.liquid')],
  ]));

  assert.deepStrictEqual(config.templates, [
    [`_includes/${path.join('blueprint', 'index.liquid')}`, 'ACTIVE INDEX'],
    ['_includes/default.liquid', 'CORE DEFAULT'],
  ]);
});

test('virtual mode with no layouts registers nothing', () => {
  const config = recordingConfig();

  registerVirtualLayouts(config, new Map());

  assert.deepStrictEqual(config.templates, []);
});

test('farm mode symlinks each winner at its relative path, dirs created', (t) => {
  const root = fixture(t, {
    'active/blueprint/index.liquid': 'ACTIVE INDEX',
    'core/default.liquid': 'CORE DEFAULT',
  });
  const farm = path.join(root, 'farm');

  composeSymlinkFarm(new Map([
    [path.join('blueprint', 'index.liquid'), path.join(root, 'active', 'blueprint', 'index.liquid')],
    ['default.liquid', path.join(root, 'core', 'default.liquid')],
  ]), farm);

  const nested = path.join(farm, 'blueprint', 'index.liquid');
  assert.strictEqual(fs.lstatSync(nested).isSymbolicLink(), true, 'a LINK, never a copy');
  assert.strictEqual(fs.readlinkSync(nested), path.join(root, 'active', 'blueprint', 'index.liquid'));
  assert.strictEqual(fs.readFileSync(nested, 'utf8'), 'ACTIVE INDEX');
  assert.strictEqual(fs.readFileSync(path.join(farm, 'default.liquid'), 'utf8'), 'CORE DEFAULT');
});

test('the farm is rebuilt from scratch — a dropped layout leaves no stale link', (t) => {
  const root = fixture(t, {
    'core/a.liquid': 'A',
    'core/b.liquid': 'B',
  });
  const farm = path.join(root, 'farm');

  composeSymlinkFarm(new Map([
    ['a.liquid', path.join(root, 'core', 'a.liquid')],
    ['b.liquid', path.join(root, 'core', 'b.liquid')],
  ]), farm);
  assert.deepStrictEqual(fs.readdirSync(farm).sort(), ['a.liquid', 'b.liquid']);

  composeSymlinkFarm(new Map([['a.liquid', path.join(root, 'core', 'a.liquid')]]), farm);
  assert.deepStrictEqual(fs.readdirSync(farm), ['a.liquid']);
});

test('composing twice with the same map is idempotent, never an EEXIST', (t) => {
  const root = fixture(t, { 'core/a.liquid': 'A' });
  const farm = path.join(root, 'farm');
  const map = new Map([['a.liquid', path.join(root, 'core', 'a.liquid')]]);

  composeSymlinkFarm(map, farm);
  composeSymlinkFarm(map, farm);

  assert.deepStrictEqual(fs.readdirSync(farm), ['a.liquid']);
  assert.strictEqual(fs.readFileSync(path.join(farm, 'a.liquid'), 'utf8'), 'A');
});

test('an empty map leaves an empty farm dir behind', (t) => {
  const root = fixture(t, { 'core/a.liquid': 'A' });
  const farm = path.join(root, 'farm');

  composeSymlinkFarm(new Map([['a.liquid', path.join(root, 'core', 'a.liquid')]]), farm);
  composeSymlinkFarm(new Map(), farm);

  assert.strictEqual(fs.existsSync(farm), false, 'nothing to link means nothing to compose');
});
