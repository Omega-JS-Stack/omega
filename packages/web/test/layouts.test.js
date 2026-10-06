/**
 * layouts.js — layered layout DELIVERY, both modes, with ZERO file copying:
 * `virtual` registers each winner as an Eleventy virtual template under
 * `_includes/<rel>` (build), and `farm` composes a symlink farm (dev — the
 * only watchable form, since virtual template content is captured at config
 * time). The farm is rebuilt from scratch on every call, so a layout deleted
 * upstream must not survive as a stale link.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'layouts',
  tests: [
    {
      name: 'virtual mode registers every winner under _includes/, content and all',
      run: (ctx) => {
        const root = fixture(ctx, {
          'active/blueprint/index.liquid': 'ACTIVE INDEX',
          'core/default.liquid': 'CORE DEFAULT',
        });
        const config = recordingConfig();

        registerVirtualLayouts(config, new Map([
          [path.join('blueprint', 'index.liquid'), path.join(root, 'active', 'blueprint', 'index.liquid')],
          ['default.liquid', path.join(root, 'core', 'default.liquid')],
        ]));

        ctx.expect(config.templates).toEqual([
          [`_includes/${path.join('blueprint', 'index.liquid')}`, 'ACTIVE INDEX'],
          ['_includes/default.liquid', 'CORE DEFAULT'],
        ]);
      },
    },

    {
      name: 'virtual mode with no layouts registers nothing',
      run: (ctx) => {
        const config = recordingConfig();

        registerVirtualLayouts(config, new Map());

        ctx.expect(config.templates).toEqual([]);
      },
    },

    {
      name: 'farm mode symlinks each winner at its relative path, dirs created',
      run: (ctx) => {
        const root = fixture(ctx, {
          'active/blueprint/index.liquid': 'ACTIVE INDEX',
          'core/default.liquid': 'CORE DEFAULT',
        });
        const farm = path.join(root, 'farm');

        composeSymlinkFarm(new Map([
          [path.join('blueprint', 'index.liquid'), path.join(root, 'active', 'blueprint', 'index.liquid')],
          ['default.liquid', path.join(root, 'core', 'default.liquid')],
        ]), farm);

        const nested = path.join(farm, 'blueprint', 'index.liquid');
        ctx.expect(fs.lstatSync(nested).isSymbolicLink(), 'a LINK, never a copy').toBe(true);
        ctx.expect(fs.readlinkSync(nested)).toBe(path.join(root, 'active', 'blueprint', 'index.liquid'));
        ctx.expect(fs.readFileSync(nested, 'utf8')).toBe('ACTIVE INDEX');
        ctx.expect(fs.readFileSync(path.join(farm, 'default.liquid'), 'utf8')).toBe('CORE DEFAULT');
      },
    },

    {
      name: 'the farm is rebuilt from scratch — a dropped layout leaves no stale link',
      run: (ctx) => {
        const root = fixture(ctx, {
          'core/a.liquid': 'A',
          'core/b.liquid': 'B',
        });
        const farm = path.join(root, 'farm');

        composeSymlinkFarm(new Map([
          ['a.liquid', path.join(root, 'core', 'a.liquid')],
          ['b.liquid', path.join(root, 'core', 'b.liquid')],
        ]), farm);
        ctx.expect(fs.readdirSync(farm).sort()).toEqual(['a.liquid', 'b.liquid']);

        composeSymlinkFarm(new Map([['a.liquid', path.join(root, 'core', 'a.liquid')]]), farm);
        ctx.expect(fs.readdirSync(farm)).toEqual(['a.liquid']);
      },
    },

    {
      name: 'composing twice with the same map is idempotent, never an EEXIST',
      run: (ctx) => {
        const root = fixture(ctx, { 'core/a.liquid': 'A' });
        const farm = path.join(root, 'farm');
        const map = new Map([['a.liquid', path.join(root, 'core', 'a.liquid')]]);

        composeSymlinkFarm(map, farm);
        composeSymlinkFarm(map, farm);

        ctx.expect(fs.readdirSync(farm)).toEqual(['a.liquid']);
        ctx.expect(fs.readFileSync(path.join(farm, 'a.liquid'), 'utf8')).toBe('A');
      },
    },

    {
      name: 'an empty map leaves an empty farm dir behind',
      run: (ctx) => {
        const root = fixture(ctx, { 'core/a.liquid': 'A' });
        const farm = path.join(root, 'farm');

        composeSymlinkFarm(new Map([['a.liquid', path.join(root, 'core', 'a.liquid')]]), farm);
        composeSymlinkFarm(new Map(), farm);

        ctx.expect(fs.existsSync(farm), 'nothing to link means nothing to compose').toBe(false);
      },
    },
  ],
});
