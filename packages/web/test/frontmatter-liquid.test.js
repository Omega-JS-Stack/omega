/**
 * frontmatter-liquid resolver: scope + caching semantics. `site.*` values are
 * build-constant (rendered once, cached by raw source); `page.*` and
 * `resolved.*` values are PER-PAGE — rendered uncached against the caller's
 * extraScope, and left RAW when no scope exists yet (the preprocessor defers
 * them to the engine's `resolved` computed, which passes { resolved, page }).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { createFrontmatterResolver } = require('../src/frontmatter-liquid.js');

const site = { brand: { name: 'MiniCo' }, theme: { id: 'classy' } };

module.exports = defineCases({
  type: 'group',
  description: 'frontmatter-liquid',
  tests: [
    {
      name: 'site refs render against the constant site global and cache by raw source',
      run: (ctx) => {
        const resolver = createFrontmatterResolver({ site });
        ctx.expect(resolver.render('Welcome to {{ site.brand.name }}')).toBe('Welcome to MiniCo');
        ctx.expect(resolver.cacheSize()).toBe(1);
        ctx.expect(resolver.render('Welcome to {{ site.brand.name }}')).toBe('Welcome to MiniCo');
        ctx.expect(resolver.cacheSize(), 'second render served from cache').toBe(1);
      },
    },

    {
      name: '#830 a retired Jekyll filter name in a frontmatter value throws naming its replacement',
      run: (ctx) => {
        const resolver = createFrontmatterResolver({ site });
        ctx.expect(() => resolver.render('{{ site.brand.name | slugify }}'), 'LiquidJS has a slugify of its own; the thrower must win').toThrow(/omega_slugify/);
      },
    },

    {
      name: 'legacy bracket refs are NOT accepted — the value renders untouched (#148)',
      run: (ctx) => {
        const resolver = createFrontmatterResolver({ site });
        const value = 'themes/[ site.theme.id ]/frontend/core/base';
        ctx.expect(resolver.render(value), 'brackets are literal text — `omega migrate` is the converter').toBe(value);
      },
    },

    {
      name: 'resolved refs render against the per-page scope (layout-default templating)',
      run: (ctx) => {
        const resolver = createFrontmatterResolver({ site });
        const tpl = "d-flex align-items-{{ resolved.theme.main.align | default: 'center' }} py-5";
        const out = resolver.render(tpl, { resolved: { theme: { main: { align: 'start' } } } });
        ctx.expect(out).toBe('d-flex align-items-start py-5');
      },
    },

    {
      name: 'resolved refs are per-page: a second page must not inherit the first rendering',
      run: (ctx) => {
        const resolver = createFrontmatterResolver({ site });
        const tpl = "align-items-{{ resolved.theme.main.align | default: 'center' }}";
        ctx.expect(resolver.render(tpl, { resolved: { theme: { main: { align: 'start' } } } })).toBe('align-items-start');
        ctx.expect(resolver.render(tpl, { resolved: {} }), 'default applies when the page sets no align').toBe('align-items-center');
        ctx.expect(resolver.cacheSize(), 'per-page renderings never enter the raw-string cache').toBe(0);
      },
    },

    {
      name: 'resolved refs without a per-page scope stay raw (deferred, not rendered empty)',
      run: (ctx) => {
        const resolver = createFrontmatterResolver({ site });
        const tpl = 'The #1 {{ resolved.alternative.competitor.name }} alternative';
        ctx.expect(resolver.render(tpl)).toBe(tpl);
      },
    },

    {
      name: 'renderData renders resolved refs through the merged tree (engine resolved pass)',
      run: (ctx) => {
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
        ctx.expect(out.theme.main.class).toBe('align-items-start');
        ctx.expect(out.alternative.hero.tagline).toBe('The #1 Acme Growth alternative');
        ctx.expect(out.untouched, 'copy-on-write: untouched subtrees keep identity').toBe(data.untouched);
      },
    },
  ],
});
