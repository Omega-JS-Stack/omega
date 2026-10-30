/**
 * filters.test.js — omega_* filter semantics, incl. Ruby-parity pins.
 *
 * Parity values verified against real Ruby (ruby 4.0.0, 2026-07-06):
 *   Digest::MD5.hexdigest('hello').hex % 1000 == 994
 *   Digest::MD5.hexdigest('somiibo').hex % 360 == 305
 *   'hello WORLD' per-word capitalize == 'Hello World'
 * Documented divergence: Ruby's omega_commaify groups DECIMAL digits too
 * ('1234.5678' => '1,234.5,678' — a latent bug); ours commas only the whole
 * part ('1,234.5678') per the best-implementation-wins rule.
 *
 * The helpers that replaced the Jekyll-era names (omega_slugify, the dates,
 * the url joins, omega_where / omega_group_by) are pinned through a real engine
 * by their registered names: those names are what templates are written against.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const { Liquid } = require('liquidjs');
const filters = require('../src/filters.js');
const { registerLiquid } = require('../src/register-liquid.js');

// strictFilters: an unregistered name throws instead of passing its input through.
function render(template, scope = {}, options = {}) {
  const engine = new Liquid({ strictFilters: true });
  registerLiquid(engine, { site: options.site || {}, markdown: options.markdown });
  return engine.parseAndRender(template, scope);
}

// One line per group, `name:size=titles;`, so order inside and across groups shows.
const GROUPS = '{% assign groups = items | omega_group_by: "item", expr %}{% for group in groups %}{{ group.name }}:{{ group.size }}={{ group.items | map: "title" | join: "," }};{% endfor %}';
const WHERE_VIEWS = '{% assign kept = items | omega_where: "item", expr %}{{ kept | map: "views" | join: "," }}';

module.exports = defineCases({
  type: 'group',
  description: 'filters',
  tests: [
    {
      name: 'omegaStripAds removes ad-unit blocks and adunit includes',
      run: (ctx) => {
        const input = 'before\n<ad-unit>\nstuff\n</ad-unit>\nafter {% include /master/modules/adunits/banner.html %} end';
        const out = filters.omegaStripAds(input);
        ctx.expect(!out.includes('ad-unit')).toBeTruthy();
        ctx.expect(!out.includes('adunits')).toBeTruthy();
        ctx.expect(out.includes('before')).toBeTruthy();
        ctx.expect(out.includes('after')).toBeTruthy();
        ctx.expect(out.includes('end')).toBeTruthy();
      },
    },

    {
      name: 'omegaJsonEscape escapes without surrounding quotes',
      run: (ctx) => {
        ctx.expect(filters.omegaJsonEscape('say "hi"\nnow')).toBe('say \\"hi\\"\\nnow');
        ctx.expect(filters.omegaJsonEscape('back\\slash')).toBe('back\\\\slash');
      },
    },

    {
      name: 'omegaHash matches Ruby full-hexdigest BigInt semantics',
      run: (ctx) => {
        ctx.expect(filters.omegaHash('hello', 1000)).toBe(994);
        ctx.expect(filters.omegaHash('somiibo', 360)).toBe(305);
        // Deterministic
        ctx.expect(filters.omegaHash('hello', 1000)).toBe(filters.omegaHash('hello', 1000));
      },
    },

    {
      name: 'omegaRandom stays in [0, max)',
      run: (ctx) => {
        for (let i = 0; i < 50; i++) {
          const value = filters.omegaRandom(10);
          ctx.expect(value >= 0 && value < 10 && Number.isInteger(value)).toBeTruthy();
        }
      },
    },

    {
      name: 'omegaTitleCase matches Ruby per-word capitalize',
      run: (ctx) => {
        ctx.expect(filters.omegaTitleCase('hello WORLD')).toBe('Hello World');
        ctx.expect(filters.omegaTitleCase('social media automation')).toBe('Social Media Automation');
      },
    },

    {
      name: 'omegaJsonify is compact by default and pretty-prints with an indent (#830)',
      run: (ctx) => {
        ctx.expect(filters.omegaJsonify({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
        ctx.expect(filters.omegaJsonify('hi')).toBe('"hi"');
        ctx.expect(filters.omegaJsonify({ a: 1 }, 2)).toBe('{\n  "a": 1\n}');
        ctx.expect(filters.omegaJsonify({ a: 1 }, 4)).toBe('{\n    "a": 1\n}');

        // It took over jsonify's call sites, JSON feeds among them: an absent
        // value emits null (Ruby nil.to_json parity), never an empty slot.
        ctx.expect(filters.omegaJsonify(null)).toBe('null');
        ctx.expect(filters.omegaJsonify(undefined)).toBe('null');
      },
    },

    {
      name: 'omegaAppendParam handles bare and existing query strings',
      run: (ctx) => {
        ctx.expect(filters.omegaAppendParam('https://x.com/img.png', 'cb', '123')).toBe('https://x.com/img.png?cb=123');
        ctx.expect(filters.omegaAppendParam('https://x.com/img.png?w=200', 'cb', '123')).toBe('https://x.com/img.png?w=200&cb=123');
        ctx.expect(filters.omegaAppendParam('', 'cb', '1')).toBe('');
        ctx.expect(filters.omegaAppendParam(null, 'cb', '1')).toBe(null);
      },
    },

    {
      name: 'omegaCachebreak appends a process-consistent cb param',
      run: (ctx) => {
        const a = filters.omegaCachebreak('https://x.com/a.png');
        const b = filters.omegaCachebreak('https://x.com/b.png?w=1');
        ctx.expect(a).toMatch(/^https:\/\/x\.com\/a\.png\?cb=\d+$/);
        ctx.expect(b).toMatch(/&cb=\d+$/);
        ctx.expect(a.split('cb=')[1]).toBe(b.split('cb=')[1]);
        ctx.expect(a.split('cb=')[1]).toBe(filters.CACHE_TIMESTAMP);
      },
    },

    {
      name: 'omegaPluralize picks singular only for exactly 1',
      run: (ctx) => {
        ctx.expect(filters.omegaPluralize(1, 'post', 'posts')).toBe('post');
        ctx.expect(filters.omegaPluralize(5, 'post', 'posts')).toBe('posts');
        ctx.expect(filters.omegaPluralize(0, 'post', 'posts')).toBe('posts');
        ctx.expect(filters.omegaPluralize(2, 'box')).toBe('boxs'); // Ruby parity: naive default
      },
    },

    {
      name: 'omegaCommaify formats integers and passes junk through',
      run: (ctx) => {
        ctx.expect(filters.omegaCommaify(10000)).toBe('10,000');
        ctx.expect(filters.omegaCommaify('1234567')).toBe('1,234,567');
        ctx.expect(filters.omegaCommaify('-1234567')).toBe('-1,234,567');
        ctx.expect(filters.omegaCommaify('1234.5678')).toBe('1,234.5678'); // divergence: Ruby gives '1,234.5,678'
        ctx.expect(filters.omegaCommaify('not a number')).toBe('not a number');
        ctx.expect(filters.omegaCommaify('')).toBe('');
        ctx.expect(filters.omegaCommaify(null)).toBe(null);
        ctx.expect(filters.omegaCommaify(123)).toBe('123');
      },
    },

    {
      name: 'createIncrementReturn accumulates per registers object',
      run: (ctx) => {
        const registers = {};
        const increment = filters.createIncrementReturn(() => registers);
        ctx.expect(increment(1)).toBe(1);
        ctx.expect(increment(1)).toBe(2);
        ctx.expect(increment(5)).toBe(7);

        const fresh = {};
        const increment2 = filters.createIncrementReturn(() => fresh);
        ctx.expect(increment2(1)).toBe(1);
      },
    },

    {
      name: 'createLiquify renders recursively with depth + no-change guards',
      run: (ctx) => {
        const scope = { a: '{{ b }}', b: 'done' };
        const render = (str) => str.replace(/\{\{ *(\w+) *\}\}/g, (m, key) => scope[key] ?? m);

        const liquify = filters.createLiquify(render);
        ctx.expect(liquify('x {{ a }} y')).toBe('x done y');
        ctx.expect(liquify(null)).toBe('');
        // Unresolvable syntax stops on no-change instead of looping
        ctx.expect(liquify('{{ missing }}')).toBe('{{ missing }}');
      },
    },

    {
      name: 'createContentFormat markdownifies only .md pages',
      run: (ctx) => {
        const render = (str) => str;
        const markdown = (str) => `<p>${str}</p>`;

        const forMd = filters.createContentFormat(render, { markdown, getPage: () => ({ extension: '.md' }) });
        ctx.expect(forMd('hello')).toBe('<p>hello</p>');

        const forHtml = filters.createContentFormat(render, { markdown, getPage: () => ({ extension: '.html' }) });
        ctx.expect(forHtml('hello')).toBe('hello');

        ctx.expect(forMd(null)).toBe('');
      },
    },

    {
      name: 'omega_slugify answers the client slugifier rule: apostrophes deleted, runs dashed, edges trimmed',
      run: async (ctx) => {
        // The case table lives with the one slugifier, in the client's suite.
        ctx.expect(await render('{{ s | omega_slugify }}', { s: " Beginner's Guides & More " })).toBe('beginners-guides-more');
      },
    },

    {
      name: 'omega_date_xmlschema and omega_date_rfc822 render in UTC regardless of the builder timezone',
      run: async (ctx) => {
        const xml = (d) => render('{{ d | omega_date_xmlschema }}', { d });
        const rfc = (d) => render('{{ d | omega_date_rfc822 }}', { d });
        const date = new Date('2008-11-07T13:07:54Z');

        ctx.expect(await xml(date)).toBe('2008-11-07T13:07:54+00:00');
        ctx.expect(await rfc(date)).toBe('Fri, 07 Nov 2008 13:07:54 +0000');

        // A UTC midnight must not shift a day: the dated-filename convention.
        ctx.expect(await xml('2024-01-15T00:00:00Z')).toBe('2024-01-15T00:00:00+00:00');
        ctx.expect(await rfc('2024-01-15T00:00:00Z')).toBe('Mon, 15 Jan 2024 00:00:00 +0000');
      },
    },

    {
      name: 'an unparseable date passes through the omega_date_* filters untouched',
      run: async (ctx) => {
        ctx.expect(await render('{{ d | omega_date_xmlschema }}', { d: 'not a date' })).toBe('not a date');
        ctx.expect(await render('{{ d | omega_date_rfc822 }}', { d: 'not a date' })).toBe('not a date');

        // An invalid Date OBJECT is unparseable too, never "NaN-NaN-NaN" in a page.
        const invalid = new Date('not a date');
        ctx.expect(await render('{{ d | omega_date_xmlschema }}', { d: invalid })).toBe('Invalid Date');
        ctx.expect(await render('{{ d | omega_date_rfc822 }}', { d: invalid })).toBe('Invalid Date');
      },
    },

    {
      name: 'omega_strip_html drops tags and removes script/style/comment contents entirely',
      run: async (ctx) => {
        const strip = (s) => render('{{ s | omega_strip_html }}', { s });

        ctx.expect(await strip('<b>hi</b> there')).toBe('hi there');
        ctx.expect(await strip('a<script>var x = 1;</script>b')).toBe('ab');
        ctx.expect(await strip('a<style>.x { color: red }</style>b')).toBe('ab');
        ctx.expect(await strip('a<!-- secret -->b')).toBe('ab');
        ctx.expect(await strip('<p>multi\nline</p>')).toBe('multi\nline');
      },
    },

    {
      name: 'omega_number_of_words counts whitespace-separated words',
      run: async (ctx) => {
        const count = (s) => render('{{ s | omega_number_of_words }}', { s });

        ctx.expect(await count('one two three')).toBe('3');
        ctx.expect(await count('  padded   words  ')).toBe('2');
        ctx.expect(await count('one\ntwo\tthree four')).toBe('4');
        ctx.expect(await count('')).toBe('0');
        ctx.expect(await count('   ')).toBe('0');
      },
    },

    {
      name: 'omega_relative_url prefixes the baseurl and always yields a rooted path',
      run: async (ctx) => {
        const rel = (url, site) => render('{{ url | omega_relative_url }}', { url }, { site });

        ctx.expect(await rel('/blog', { baseurl: '/docs' })).toBe('/docs/blog');
        ctx.expect(await rel('blog', { baseurl: '/docs' })).toBe('/docs/blog');
        ctx.expect(await rel('/', { baseurl: '/docs' })).toBe('/docs/');

        // A trailing slash on the baseurl must not double up.
        ctx.expect(await rel('/blog', { baseurl: '/docs/' })).toBe('/docs/blog');

        // No baseurl at all is the common case.
        ctx.expect(await rel('blog', {})).toBe('/blog');
      },
    },

    {
      name: 'omega_absolute_url prefixes site.url, and leaves already-absolute URLs alone',
      run: async (ctx) => {
        const site = { url: 'https://example.com/', baseurl: '/docs' };
        const abs = (url) => render('{{ url | omega_absolute_url }}', { url }, { site });

        ctx.expect(await abs('/blog')).toBe('https://example.com/docs/blog');
        ctx.expect(await abs('blog')).toBe('https://example.com/docs/blog');
        ctx.expect(await abs('https://cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png');
        ctx.expect(await abs('http://cdn.example.com/x.png')).toBe('http://cdn.example.com/x.png');
      },
    },

    {
      name: 'omega_markdownify passes through without a converter and renders with one',
      run: async (ctx) => {
        const markdown = (md) => `<p>${md}</p>`;

        ctx.expect(await render('{{ s | omega_markdownify }}', { s: '**bold**' })).toBe('**bold**');
        ctx.expect(await render('{{ s | omega_markdownify }}', { s: 'hi' }, { markdown })).toBe('<p>hi</p>');

        // Absent input renders empty, never "null"/"undefined" text in the page.
        ctx.expect(await render('{{ s | omega_markdownify }}', { s: null })).toBe('');
        ctx.expect(await render('{{ s | omega_markdownify }}')).toBe('');
      },
    },

    {
      name: 'omega_where supports the comparison subset, literals, and bare truthiness',
      run: async (ctx) => {
        const items = [
          { type: 'post', views: 10, tags: ['a', 'b'], draft: true },
          { type: 'page', views: 3, tags: ['c'], draft: false },
          { type: 'post', views: 25, tags: [] },
        ];
        const views = (expr, list = items) => render(WHERE_VIEWS, { items: list, expr });

        ctx.expect(await views("item.type == 'post'")).toBe('10,25');
        ctx.expect(await views("item.type != 'post'")).toBe('3');
        ctx.expect(await views('item.views > 5')).toBe('10,25');
        ctx.expect(await views('item.views >= 10')).toBe('10,25');
        ctx.expect(await views('item.views < 10')).toBe('3');
        ctx.expect(await views('item.views <= 10')).toBe('10,3');
        ctx.expect(await views("item.tags contains 'b'")).toBe('10');

        // Bare path: truthiness. `false` and a missing key both fail.
        ctx.expect(await views('item.draft')).toBe('10');

        // A path on some OTHER variable name never resolves.
        ctx.expect(await views("other.type == 'post'")).toBe('');

        // Absent input is an empty list, and a single item is treated as a list.
        const size = '{% assign kept = items | omega_where: "item", expr %}{{ kept | size }}';
        ctx.expect(await render(size, { items: null, expr: 'item.draft' })).toBe('0');
        ctx.expect(await render(size, { items: items[0], expr: 'item.draft' })).toBe('1');
      },
    },

    {
      name: 'omega_group_by buckets by the stringified expression value with sizes',
      run: async (ctx) => {
        const items = [
          { type: 'post', title: 'a' },
          { type: 'page', title: 'b' },
          { type: 'post', title: 'c' },
        ];

        ctx.expect(await render(GROUPS, { items, expr: "item.type == 'post'" })).toBe('true:2=a,c;false:1=b;');
      },
    },

    {
      name: 'omega_group_by on a BARE path buckets by VALUE, one group per distinct value',
      run: async (ctx) => {
        const items = [
          { type: 'post', title: 'a' },
          { type: 'page', title: 'b' },
          { title: 'c' },
          { type: 'post', title: 'd' },
        ];

        // Groups appear in first-seen order; an absent value groups under '' so a
        // rendered group name is never the text "undefined".
        ctx.expect(await render(GROUPS, { items, expr: 'item.type' })).toBe('post:2=a,d;page:1=b;:1=c;');
      },
    },

    {
      name: 'omega_group_by keeps input order inside a group and buckets numbers by value',
      run: async (ctx) => {
        const items = [{ n: 2, title: 'a' }, { n: 1, title: 'b' }, { n: 2, title: 'c' }];

        ctx.expect(await render(GROUPS, { items, expr: 'item.n' })).toBe('2:2=a,c;1:1=b;');
      },
    },
  ],
});
