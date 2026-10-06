/**
 * layers.js — the SSG-agnostic core of the theme system: first-layer-wins
 * union collection, and the theme layer chain (consumer-local themes beat
 * packaged ones, the base layer stays last in every chain).
 *
 * themes.test.js proves this through the real theme tree; this suite pins the
 * resolution RULES against synthetic layer dirs, where the tie-breaks and the
 * missing-layer tolerance are directly visible.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { collectLayered, resolveThemeLayers } = require('../src/layers.js');

// Build a fixture tree ({ 'relative/path': contents }) and return its root.
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-layers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

module.exports = defineCases({
  type: 'group',
  description: 'layers',
  tests: [
    {
      name: 'the FIRST layer that carries a path wins; later layers fill the gaps',
      run: (ctx) => {
        const root = fixture(ctx, {
          'active/head.liquid': 'active head',
          'active/nested/hero.liquid': 'active hero',
          'base/head.liquid': 'base head',
          'base/foot.liquid': 'base foot',
          'core/foot.liquid': 'core foot',
          'core/meta.liquid': 'core meta',
        });

        const winners = collectLayered([
          path.join(root, 'active'),
          path.join(root, 'base'),
          path.join(root, 'core'),
        ]);

        ctx.expect([...winners.keys()].sort()).toEqual([
          'foot.liquid',
          'head.liquid',
          'meta.liquid',
          path.join('nested', 'hero.liquid'),
        ]);
        ctx.expect(winners.get('head.liquid')).toBe(path.join(root, 'active', 'head.liquid'));
        ctx.expect(winners.get('foot.liquid')).toBe(path.join(root, 'base', 'foot.liquid'));
        ctx.expect(winners.get('meta.liquid')).toBe(path.join(root, 'core', 'meta.liquid'));
      },
    },

    {
      name: 'missing layer dirs are skipped, never a crash',
      run: (ctx) => {
        const root = fixture(ctx, { 'core/head.liquid': 'core head' });

        const winners = collectLayered([
          path.join(root, 'does-not-exist'),
          path.join(root, 'core'),
          path.join(root, 'also-missing'),
        ]);

        ctx.expect([...winners.keys()]).toEqual(['head.liquid']);
        ctx.expect(collectLayered([]).size).toEqual(0);
      },
    },

    {
      name: 'directories never enter the union — only files do',
      run: (ctx) => {
        const root = fixture(ctx, { 'core/nested/deep/page.liquid': 'x' });

        const winners = collectLayered([path.join(root, 'core')]);

        ctx.expect([...winners.keys()]).toEqual([path.join('nested', 'deep', 'page.liquid')]);
      },
    },

    {
      name: 'the filter applies to the RELATIVE path, before the win is recorded',
      run: (ctx) => {
        const root = fixture(ctx, {
          'active/page.liquid': 'active',
          'active/page.md': 'active md',
          'base/page.liquid': 'base',
          'base/other.md': 'base md',
        });

        const winners = collectLayered(
          [path.join(root, 'active'), path.join(root, 'base')],
          /\.md$/,
        );

        ctx.expect([...winners.keys()].sort()).toEqual(['other.md', 'page.md']);
        ctx.expect(winners.get('page.md')).toBe(path.join(root, 'active', 'page.md'));
      },
    },

    {
      name: 'a theme chain is the active theme then the base layer',
      run: (ctx) => {
        const root = fixture(ctx, {
          'themes/newsflash/main.scss': '',
          'themes/base/main.scss': '',
        });
        const themesDir = path.join(root, 'themes');

        ctx.expect(resolveThemeLayers({ activeTheme: 'newsflash', themesDir })).toEqual([path.join(themesDir, 'newsflash'), path.join(themesDir, 'base')]);
      },
    },

    {
      name: 'classy is the default skin and rides over base like every theme',
      run: (ctx) => {
        const root = fixture(ctx, {
          'themes/classy/main.scss': '',
          'themes/base/main.scss': '',
        });
        const themesDir = path.join(root, 'themes');

        ctx.expect(resolveThemeLayers({ activeTheme: 'classy', themesDir })).toEqual([path.join(themesDir, 'classy'), path.join(themesDir, 'base')]);
        ctx.expect(resolveThemeLayers({ themesDir })).toEqual([path.join(themesDir, 'classy'), path.join(themesDir, 'base')]);
      },
    },

    {
      name: 'the base layer never appears twice in its own chain',
      run: (ctx) => {
        const root = fixture(ctx, { 'themes/base/main.scss': '' });
        const themesDir = path.join(root, 'themes');

        ctx.expect(resolveThemeLayers({ activeTheme: 'base', themesDir })).toEqual([path.join(themesDir, 'base')]);
      },
    },

    {
      name: 'a consumer-local theme beats the packaged one, per layer',
      run: (ctx) => {
        const root = fixture(ctx, {
          'themes/newsflash/main.scss': '',
          'themes/base/main.scss': '',
          'brand/themes/newsflash/main.scss': '',
        });
        const themesDir = path.join(root, 'themes');
        const consumerDir = path.join(root, 'brand');

        ctx.expect(resolveThemeLayers({ activeTheme: 'newsflash', consumerDir, themesDir })).toEqual([
            path.join(consumerDir, 'themes', 'newsflash'),
            // base has no local copy, so the packaged layer stays.
            path.join(themesDir, 'base'),
          ]);
      },
    },

    {
      name: 'a consumerDir without a local copy falls back to the packaged theme',
      run: (ctx) => {
        const root = fixture(ctx, {
          'themes/newsflash/main.scss': '',
          'themes/base/main.scss': '',
          'brand/src/index.md': '',
        });
        const themesDir = path.join(root, 'themes');

        ctx.expect(resolveThemeLayers({ activeTheme: 'newsflash', consumerDir: path.join(root, 'brand'), themesDir })).toEqual([path.join(themesDir, 'newsflash'), path.join(themesDir, 'base')]);
      },
    },
  ],
});
