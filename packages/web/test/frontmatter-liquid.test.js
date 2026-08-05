/**
 * frontmatter-liquid resolver: scope + caching semantics. `site.*` values are
 * build-constant (rendered once, cached by raw source); `page.*` and
 * `resolved.*` values are PER-PAGE — rendered uncached against the caller's
 * extraScope, and left RAW when no scope exists yet (the preprocessor defers
 * them to the engine's `resolved` computed, which passes { resolved, page }).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const { createFrontmatterResolver } = require('../src/frontmatter-liquid.js');

const site = { brand: { name: 'MiniCo' }, theme: { id: 'classy' } };

test('site refs render against the constant site global and cache by raw source', () => {
  const resolver = createFrontmatterResolver({ site });
  assert.strictEqual(resolver.render('Welcome to {{ site.brand.name }}'), 'Welcome to MiniCo');
  assert.strictEqual(resolver.cacheSize(), 1);
  assert.strictEqual(resolver.render('Welcome to {{ site.brand.name }}'), 'Welcome to MiniCo');
  assert.strictEqual(resolver.cacheSize(), 1, 'second render served from cache');
});

test('legacy bracket refs are NOT accepted — the value renders untouched (#148)', () => {
  const resolver = createFrontmatterResolver({ site });
  const value = 'themes/[ site.theme.id ]/frontend/core/base';
  assert.strictEqual(resolver.render(value), value, 'brackets are literal text — `omega migrate` is the converter');
});

test('resolved refs render against the per-page scope (layout-default templating)', () => {
  const resolver = createFrontmatterResolver({ site });
  const tpl = "d-flex align-items-{{ resolved.theme.main.align | default: 'center' }} py-5";
  const out = resolver.render(tpl, { resolved: { theme: { main: { align: 'start' } } } });
  assert.strictEqual(out, 'd-flex align-items-start py-5');
});

test('resolved refs are per-page: a second page must not inherit the first rendering', () => {
  const resolver = createFrontmatterResolver({ site });
  const tpl = "align-items-{{ resolved.theme.main.align | default: 'center' }}";
  assert.strictEqual(resolver.render(tpl, { resolved: { theme: { main: { align: 'start' } } } }), 'align-items-start');
  assert.strictEqual(resolver.render(tpl, { resolved: {} }), 'align-items-center', 'default applies when the page sets no align');
  assert.strictEqual(resolver.cacheSize(), 0, 'per-page renderings never enter the raw-string cache');
});

test('resolved refs without a per-page scope stay raw (deferred, not rendered empty)', () => {
  const resolver = createFrontmatterResolver({ site });
  const tpl = 'The #1 {{ resolved.alternative.competitor.name }} alternative';
  assert.strictEqual(resolver.render(tpl), tpl);
});

test('renderData renders resolved refs through the merged tree (engine resolved pass)', () => {
  const resolver = createFrontmatterResolver({ site });
  const data = {
    theme: { main: { class: "align-items-{{ resolved.theme.main.align | default: 'center' }}", align: 'start' } },
    alternative: {
      competitor: { name: 'Acme Growth' },
      hero: { tagline: 'The #1 {{ resolved.alternative.competitor.name }} alternative' },
    },
    untouched: { keep: 'me' },
  };
  const out = resolver.renderData(data, { resolved: data });
  assert.strictEqual(out.theme.main.class, 'align-items-start');
  assert.strictEqual(out.alternative.hero.tagline, 'The #1 Acme Growth alternative');
  assert.strictEqual(out.untouched, data.untouched, 'copy-on-write: untouched subtrees keep identity');
});
