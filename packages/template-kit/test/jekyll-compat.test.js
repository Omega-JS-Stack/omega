/**
 * jekyll-compat.test.js — the helper semantics, direct.
 *
 * register-liquid.test.js proves these reach LiquidJS under their familiar
 * Jekyll-style names; this suite pins the SEMANTICS templates depend on —
 * UTC-pinned dates (CI builds run UTC, content dates are UTC midnights),
 * the baseurl/url join rules, and the where_exp/group_by_exp expression
 * subset, whose comparison table nothing else exercises.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const compat = require('../src/jekyll-compat.js');

module.exports = defineCases({
  type: 'group',
  description: 'jekyll-compat',
  tests: [
    {
      name: 'slugify downcases and collapses non-alphanumeric runs',
      run: (ctx) => {
        ctx.expect(compat.slugify('Hello World & Friends')).toBe('hello-world-friends');
        ctx.expect(compat.slugify('  Leading and trailing  ')).toBe('leading-and-trailing');
        ctx.expect(compat.slugify('Top 10 Products (2025)')).toBe('top-10-products-2025');
        ctx.expect(compat.slugify('already-a-slug')).toBe('already-a-slug');
        ctx.expect(compat.slugify('---')).toBe('');
        ctx.expect(compat.slugify('')).toBe('');
      },
    },

    {
      name: 'slugify DELETES an apostrophe instead of separating on it (#597)',
      run: (ctx) => {
        // UJM deleted apostrophes, so a migrating brand's "Beginner's Guides"
        // category lives at /beginners-guides. Separating on it moved every such
        // URL (soundgrail lost two live category pages to `beginner-s-guides`).
        ctx.expect(compat.slugify("Beginner's Guides")).toBe('beginners-guides');
        ctx.expect(compat.slugify('Beginner’s Music Guide')).toBe('beginners-music-guide');
        ctx.expect(compat.slugify("Don't & Won't")).toBe('dont-wont');
        // A leading/trailing apostrophe leaves nothing behind either.
        ctx.expect(compat.slugify("'Tis the season'")).toBe('tis-the-season');
      },
    },

    {
      name: 'dates render in UTC regardless of the builder timezone',
      run: (ctx) => {
        const date = new Date('2008-11-07T13:07:54Z');

        ctx.expect(compat.dateToXmlschema(date)).toBe('2008-11-07T13:07:54+00:00');
        ctx.expect(compat.dateToRfc822(date)).toBe('Fri, 07 Nov 2008 13:07:54 +0000');

        // A UTC midnight must not shift a day — the dated-filename convention.
        ctx.expect(compat.dateToXmlschema('2024-01-15T00:00:00Z')).toBe('2024-01-15T00:00:00+00:00');
        ctx.expect(compat.dateToRfc822('2024-01-15T00:00:00Z')).toBe('Mon, 15 Jan 2024 00:00:00 +0000');
      },
    },

    {
      name: 'an unparseable date passes through untouched',
      run: (ctx) => {
        ctx.expect(compat.dateToXmlschema('not a date')).toBe('not a date');
        ctx.expect(compat.dateToRfc822('not a date')).toBe('not a date');

        // An invalid Date OBJECT is unparseable too — never "NaN-NaN-NaN" in a page.
        const invalid = new Date('not a date');
        ctx.expect(compat.dateToXmlschema(invalid)).toBe(invalid);
        ctx.expect(compat.dateToRfc822(invalid)).toBe(invalid);
      },
    },

    {
      name: 'jsonify encodes values, and an absent value emits null (Ruby nil.to_json parity)',
      run: (ctx) => {
        ctx.expect(compat.jsonify({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
        ctx.expect(compat.jsonify('hi')).toBe('"hi"');
        ctx.expect(compat.jsonify(null)).toBe('null');
        ctx.expect(compat.jsonify(undefined)).toBe('null');
      },
    },

    {
      name: 'strip_html drops tags and removes script/style/comment contents entirely',
      run: (ctx) => {
        ctx.expect(compat.stripHtml('<b>hi</b> there')).toBe('hi there');
        ctx.expect(compat.stripHtml('a<script>var x = 1;</script>b')).toBe('ab');
        ctx.expect(compat.stripHtml('a<style>.x { color: red }</style>b')).toBe('ab');
        ctx.expect(compat.stripHtml('a<!-- secret -->b')).toBe('ab');
        ctx.expect(compat.stripHtml('<p>multi\nline</p>')).toBe('multi\nline');
      },
    },

    {
      name: 'number_of_words counts whitespace-separated words',
      run: (ctx) => {
        ctx.expect(compat.numberOfWords('one two three')).toBe(3);
        ctx.expect(compat.numberOfWords('  padded   words  ')).toBe(2);
        ctx.expect(compat.numberOfWords('one\ntwo\tthree four')).toBe(4);
        ctx.expect(compat.numberOfWords('')).toBe(0);
        ctx.expect(compat.numberOfWords('   ')).toBe(0);
      },
    },

    {
      name: 'relative_url prefixes the baseurl and always yields a rooted path',
      run: (ctx) => {
        const rel = compat.createRelativeUrl({ baseurl: '/docs' });

        ctx.expect(rel('/blog')).toBe('/docs/blog');
        ctx.expect(rel('blog')).toBe('/docs/blog');
        ctx.expect(rel('/')).toBe('/docs/');

        // A trailing slash on the baseurl must not double up.
        ctx.expect(compat.createRelativeUrl({ baseurl: '/docs/' })('/blog')).toBe('/docs/blog');

        // No baseurl at all is the common case.
        ctx.expect(compat.createRelativeUrl()('blog')).toBe('/blog');
      },
    },

    {
      name: 'absolute_url prefixes site.url, and leaves already-absolute URLs alone',
      run: (ctx) => {
        const abs = compat.createAbsoluteUrl({ url: 'https://example.com/', baseurl: '/docs' });

        ctx.expect(abs('/blog')).toBe('https://example.com/docs/blog');
        ctx.expect(abs('blog')).toBe('https://example.com/docs/blog');
        ctx.expect(abs('https://cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png');
        ctx.expect(abs('http://cdn.example.com/x.png')).toBe('http://cdn.example.com/x.png');
      },
    },

    {
      name: 'markdownify passes through without a converter and renders with one',
      run: (ctx) => {
        ctx.expect(compat.createMarkdownify()('**bold**')).toBe('**bold**');
        ctx.expect(compat.createMarkdownify((md) => `<p>${md}</p>`)('hi')).toBe('<p>hi</p>');

        // Absent input renders empty, never "null"/"undefined" text in the page.
        ctx.expect(compat.createMarkdownify()(null)).toBe('');
        ctx.expect(compat.createMarkdownify()(undefined)).toBe('');
      },
    },

    {
      name: 'where_exp supports the comparison subset, literals, and bare truthiness',
      run: (ctx) => {
        const items = [
          { type: 'post', views: 10, tags: ['a', 'b'], draft: true },
          { type: 'page', views: 3, tags: ['c'], draft: false },
          { type: 'post', views: 25, tags: [] },
        ];

        ctx.expect(compat.whereExp(items, 'item', "item.type == 'post'").map((i) => i.views)).toEqual([10, 25]);
        ctx.expect(compat.whereExp(items, 'item', "item.type != 'post'").map((i) => i.views)).toEqual([3]);
        ctx.expect(compat.whereExp(items, 'item', 'item.views > 5').map((i) => i.views)).toEqual([10, 25]);
        ctx.expect(compat.whereExp(items, 'item', 'item.views >= 10').map((i) => i.views)).toEqual([10, 25]);
        ctx.expect(compat.whereExp(items, 'item', 'item.views < 10').map((i) => i.views)).toEqual([3]);
        ctx.expect(compat.whereExp(items, 'item', 'item.views <= 10').map((i) => i.views)).toEqual([10, 3]);
        ctx.expect(compat.whereExp(items, 'item', "item.tags contains 'b'").map((i) => i.views)).toEqual([10]);

        // Bare path — truthiness. `false` and a missing key both fail.
        ctx.expect(compat.whereExp(items, 'item', 'item.draft').map((i) => i.views)).toEqual([10]);

        // A path on some OTHER variable name never resolves.
        ctx.expect(compat.whereExp(items, 'item', "other.type == 'post'")).toEqual([]);

        // Absent input is an empty list, and a single item is treated as a list.
        ctx.expect(compat.whereExp(null, 'item', 'item.draft')).toEqual([]);
        ctx.expect(compat.whereExp(items[0], 'item', 'item.draft')).toEqual([items[0]]);
      },
    },

    {
      name: 'group_by_exp buckets by the stringified expression value with sizes',
      run: (ctx) => {
        const items = [
          { type: 'post', title: 'a' },
          { type: 'page', title: 'b' },
          { type: 'post', title: 'c' },
        ];

        const groups = compat.groupByExp(items, 'item', "item.type == 'post'");

        ctx.expect(groups.map((g) => [g.name, g.size])).toEqual([['true', 2], ['false', 1]]);
        ctx.expect(groups[0].items.map((i) => i.title)).toEqual(['a', 'c']);
        ctx.expect(groups[1].items.map((i) => i.title)).toEqual(['b']);
      },
    },

    {
      name: 'group_by_exp on a BARE path buckets by VALUE, one group per distinct value',
      run: (ctx) => {
        const items = [
          { type: 'post', title: 'a' },
          { type: 'page', title: 'b' },
          { title: 'c' },
          { type: 'post', title: 'd' },
        ];

        const groups = compat.groupByExp(items, 'item', 'item.type');

        // Groups appear in first-seen order; an absent value groups under '' so a
        // rendered group name is never the text "undefined".
        ctx.expect(groups.map((g) => [g.name, g.size])).toEqual([['post', 2], ['page', 1], ['', 1]]);
        ctx.expect(groups[0].items.map((i) => i.title)).toEqual(['a', 'd']);
        ctx.expect(groups[1].items.map((i) => i.title)).toEqual(['b']);
        ctx.expect(groups[2].items.map((i) => i.title)).toEqual(['c']);
      },
    },

    {
      name: 'group_by_exp keeps input order inside a group and buckets numbers by value',
      run: (ctx) => {
        const items = [{ n: 2 }, { n: 1 }, { n: 2 }];

        const groups = compat.groupByExp(items, 'item', 'item.n');

        ctx.expect(groups.map((g) => [g.name, g.size])).toEqual([['2', 2], ['1', 1]]);
      },
    },

    {
      name: 'COMPAT_NAMES maps the Jekyll filter names onto the implementations',
      run: (ctx) => {
        ctx.expect(Object.keys(compat.COMPAT_NAMES).sort()).toEqual([
          'date_to_rfc822',
          'date_to_xmlschema',
          'group_by_exp',
          'jsonify',
          'number_of_words',
          'slugify',
          'strip_html',
          'where_exp',
        ]);
        ctx.expect(compat.COMPAT_NAMES.slugify).toBe(compat.slugify);
        ctx.expect(compat.COMPAT_NAMES.strip_html).toBe(compat.stripHtml);
      },
    },
  ],
});
