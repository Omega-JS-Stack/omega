/**
 * layers.js — the SSG-agnostic core of the theme system: first-layer-wins
 * union collection, and the theme layer chain (consumer-local themes beat
 * packaged ones, the base layer stays last in every chain).
 *
 * themes.test.js proves this through the real theme tree; this suite pins the
 * resolution RULES against synthetic layer dirs, where the tie-breaks and the
 * missing-layer tolerance are directly visible.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

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

test('the FIRST layer that carries a path wins; later layers fill the gaps', (t) => {
  const root = fixture(t, {
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

  assert.deepStrictEqual([...winners.keys()].sort(), [
    'foot.liquid',
    'head.liquid',
    'meta.liquid',
    path.join('nested', 'hero.liquid'),
  ]);
  assert.strictEqual(winners.get('head.liquid'), path.join(root, 'active', 'head.liquid'));
  assert.strictEqual(winners.get('foot.liquid'), path.join(root, 'base', 'foot.liquid'));
  assert.strictEqual(winners.get('meta.liquid'), path.join(root, 'core', 'meta.liquid'));
});

test('missing layer dirs are skipped, never a crash', (t) => {
  const root = fixture(t, { 'core/head.liquid': 'core head' });

  const winners = collectLayered([
    path.join(root, 'does-not-exist'),
    path.join(root, 'core'),
    path.join(root, 'also-missing'),
  ]);

  assert.deepStrictEqual([...winners.keys()], ['head.liquid']);
  assert.deepStrictEqual(collectLayered([]).size, 0);
});

test('directories never enter the union — only files do', (t) => {
  const root = fixture(t, { 'core/nested/deep/page.liquid': 'x' });

  const winners = collectLayered([path.join(root, 'core')]);

  assert.deepStrictEqual([...winners.keys()], [path.join('nested', 'deep', 'page.liquid')]);
});

test('the filter applies to the RELATIVE path, before the win is recorded', (t) => {
  const root = fixture(t, {
    'active/page.liquid': 'active',
    'active/page.md': 'active md',
    'base/page.liquid': 'base',
    'base/other.md': 'base md',
  });

  const winners = collectLayered(
    [path.join(root, 'active'), path.join(root, 'base')],
    /\.md$/,
  );

  assert.deepStrictEqual([...winners.keys()].sort(), ['other.md', 'page.md']);
  assert.strictEqual(winners.get('page.md'), path.join(root, 'active', 'page.md'));
});

test('a theme chain is the active theme then the base layer', (t) => {
  const root = fixture(t, {
    'themes/newsflash/main.scss': '',
    'themes/base/main.scss': '',
  });
  const themesDir = path.join(root, 'themes');

  assert.deepStrictEqual(
    resolveThemeLayers({ activeTheme: 'newsflash', themesDir }),
    [path.join(themesDir, 'newsflash'), path.join(themesDir, 'base')],
  );
});

test('classy is the default skin and rides over base like every theme', (t) => {
  const root = fixture(t, {
    'themes/classy/main.scss': '',
    'themes/base/main.scss': '',
  });
  const themesDir = path.join(root, 'themes');

  assert.deepStrictEqual(
    resolveThemeLayers({ activeTheme: 'classy', themesDir }),
    [path.join(themesDir, 'classy'), path.join(themesDir, 'base')],
  );
  assert.deepStrictEqual(
    resolveThemeLayers({ themesDir }),
    [path.join(themesDir, 'classy'), path.join(themesDir, 'base')],
  );
});

test('the base layer never appears twice in its own chain', (t) => {
  const root = fixture(t, { 'themes/base/main.scss': '' });
  const themesDir = path.join(root, 'themes');

  assert.deepStrictEqual(
    resolveThemeLayers({ activeTheme: 'base', themesDir }),
    [path.join(themesDir, 'base')],
  );
});

test('a consumer-local theme beats the packaged one, per layer', (t) => {
  const root = fixture(t, {
    'themes/newsflash/main.scss': '',
    'themes/base/main.scss': '',
    'brand/themes/newsflash/main.scss': '',
  });
  const themesDir = path.join(root, 'themes');
  const consumerDir = path.join(root, 'brand');

  assert.deepStrictEqual(
    resolveThemeLayers({ activeTheme: 'newsflash', consumerDir, themesDir }),
    [
      path.join(consumerDir, 'themes', 'newsflash'),
      // base has no local copy, so the packaged layer stays.
      path.join(themesDir, 'base'),
    ],
  );
});

test('a consumerDir without a local copy falls back to the packaged theme', (t) => {
  const root = fixture(t, {
    'themes/newsflash/main.scss': '',
    'themes/base/main.scss': '',
    'brand/src/index.md': '',
  });
  const themesDir = path.join(root, 'themes');

  assert.deepStrictEqual(
    resolveThemeLayers({ activeTheme: 'newsflash', consumerDir: path.join(root, 'brand'), themesDir }),
    [path.join(themesDir, 'newsflash'), path.join(themesDir, 'base')],
  );
});
