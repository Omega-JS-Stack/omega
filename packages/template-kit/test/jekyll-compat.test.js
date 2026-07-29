/**
 * jekyll-compat.test.js — the Jekyll filter semantics, direct.
 *
 * register-liquid.test.js proves these reach LiquidJS under their Jekyll
 * names; this suite pins the SEMANTICS the ported templates depend on —
 * UTC-pinned dates (CI builds run UTC, content dates are UTC midnights),
 * the baseurl/url join rules, and the where_exp/group_by_exp expression
 * subset, whose comparison table nothing else exercises.
 */

const test = require('node:test');
const assert = require('node:assert');
const compat = require('../src/jekyll-compat.js');

test('slugify downcases and collapses non-alphanumeric runs', () => {
  assert.strictEqual(compat.slugify('Hello World & Friends'), 'hello-world-friends');
  assert.strictEqual(compat.slugify('  Leading and trailing  '), 'leading-and-trailing');
  assert.strictEqual(compat.slugify('Top 10 Products (2025)'), 'top-10-products-2025');
  assert.strictEqual(compat.slugify('already-a-slug'), 'already-a-slug');
  assert.strictEqual(compat.slugify('---'), '');
  assert.strictEqual(compat.slugify(''), '');
});

test('dates render in UTC regardless of the builder timezone', () => {
  const date = new Date('2008-11-07T13:07:54Z');

  assert.strictEqual(compat.dateToXmlschema(date), '2008-11-07T13:07:54+00:00');
  assert.strictEqual(compat.dateToRfc822(date), 'Fri, 07 Nov 2008 13:07:54 +0000');

  // A UTC midnight must not shift a day — the dated-filename convention.
  assert.strictEqual(compat.dateToXmlschema('2024-01-15T00:00:00Z'), '2024-01-15T00:00:00+00:00');
  assert.strictEqual(compat.dateToRfc822('2024-01-15T00:00:00Z'), 'Mon, 15 Jan 2024 00:00:00 +0000');
});

test('an unparseable date passes through untouched', () => {
  assert.strictEqual(compat.dateToXmlschema('not a date'), 'not a date');
  assert.strictEqual(compat.dateToRfc822('not a date'), 'not a date');
});

test('jsonify encodes values, and an absent value emits null (Ruby nil.to_json parity)', () => {
  assert.strictEqual(compat.jsonify({ a: 1, b: [2, 3] }), '{"a":1,"b":[2,3]}');
  assert.strictEqual(compat.jsonify('hi'), '"hi"');
  assert.strictEqual(compat.jsonify(null), 'null');
  assert.strictEqual(compat.jsonify(undefined), 'null');
});

test('strip_html drops tags and removes script/style/comment contents entirely', () => {
  assert.strictEqual(compat.stripHtml('<b>hi</b> there'), 'hi there');
  assert.strictEqual(compat.stripHtml('a<script>var x = 1;</script>b'), 'ab');
  assert.strictEqual(compat.stripHtml('a<style>.x { color: red }</style>b'), 'ab');
  assert.strictEqual(compat.stripHtml('a<!-- secret -->b'), 'ab');
  assert.strictEqual(compat.stripHtml('<p>multi\nline</p>'), 'multi\nline');
});

test('number_of_words counts whitespace-separated words', () => {
  assert.strictEqual(compat.numberOfWords('one two three'), 3);
  assert.strictEqual(compat.numberOfWords('  padded   words  '), 2);
  assert.strictEqual(compat.numberOfWords('one\ntwo\tthree four'), 4);
  assert.strictEqual(compat.numberOfWords(''), 0);
  assert.strictEqual(compat.numberOfWords('   '), 0);
});

test('relative_url prefixes the baseurl and always yields a rooted path', () => {
  const rel = compat.createRelativeUrl({ baseurl: '/docs' });

  assert.strictEqual(rel('/blog'), '/docs/blog');
  assert.strictEqual(rel('blog'), '/docs/blog');
  assert.strictEqual(rel('/'), '/docs/');

  // A trailing slash on the baseurl must not double up.
  assert.strictEqual(compat.createRelativeUrl({ baseurl: '/docs/' })('/blog'), '/docs/blog');

  // No baseurl at all is the common case.
  assert.strictEqual(compat.createRelativeUrl()('blog'), '/blog');
});

test('absolute_url prefixes site.url, and leaves already-absolute URLs alone', () => {
  const abs = compat.createAbsoluteUrl({ url: 'https://example.com/', baseurl: '/docs' });

  assert.strictEqual(abs('/blog'), 'https://example.com/docs/blog');
  assert.strictEqual(abs('blog'), 'https://example.com/docs/blog');
  assert.strictEqual(abs('https://cdn.example.com/x.png'), 'https://cdn.example.com/x.png');
  assert.strictEqual(abs('http://cdn.example.com/x.png'), 'http://cdn.example.com/x.png');
});

test('markdownify passes through without a converter and renders with one', () => {
  assert.strictEqual(compat.createMarkdownify()('**bold**'), '**bold**');
  assert.strictEqual(compat.createMarkdownify((md) => `<p>${md}</p>`)('hi'), '<p>hi</p>');

  // Absent input renders empty, never "null"/"undefined" text in the page.
  assert.strictEqual(compat.createMarkdownify()(null), '');
  assert.strictEqual(compat.createMarkdownify()(undefined), '');
});

test('where_exp supports the comparison subset, literals, and bare truthiness', () => {
  const items = [
    { type: 'post', views: 10, tags: ['a', 'b'], draft: true },
    { type: 'page', views: 3, tags: ['c'], draft: false },
    { type: 'post', views: 25, tags: [] },
  ];

  assert.deepStrictEqual(compat.whereExp(items, 'item', "item.type == 'post'").map((i) => i.views), [10, 25]);
  assert.deepStrictEqual(compat.whereExp(items, 'item', "item.type != 'post'").map((i) => i.views), [3]);
  assert.deepStrictEqual(compat.whereExp(items, 'item', 'item.views > 5').map((i) => i.views), [10, 25]);
  assert.deepStrictEqual(compat.whereExp(items, 'item', 'item.views >= 10').map((i) => i.views), [10, 25]);
  assert.deepStrictEqual(compat.whereExp(items, 'item', 'item.views < 10').map((i) => i.views), [3]);
  assert.deepStrictEqual(compat.whereExp(items, 'item', 'item.views <= 10').map((i) => i.views), [10, 3]);
  assert.deepStrictEqual(compat.whereExp(items, 'item', "item.tags contains 'b'").map((i) => i.views), [10]);

  // Bare path — truthiness. `false` and a missing key both fail.
  assert.deepStrictEqual(compat.whereExp(items, 'item', 'item.draft').map((i) => i.views), [10]);

  // A path on some OTHER variable name never resolves.
  assert.deepStrictEqual(compat.whereExp(items, 'item', "other.type == 'post'"), []);

  // Absent input is an empty list, and a single item is treated as a list.
  assert.deepStrictEqual(compat.whereExp(null, 'item', 'item.draft'), []);
  assert.deepStrictEqual(compat.whereExp(items[0], 'item', 'item.draft'), [items[0]]);
});

test('group_by_exp buckets by the stringified expression value with sizes', () => {
  const items = [
    { type: 'post', title: 'a' },
    { type: 'page', title: 'b' },
    { type: 'post', title: 'c' },
  ];

  const groups = compat.groupByExp(items, 'item', "item.type == 'post'");

  assert.deepStrictEqual(groups.map((g) => [g.name, g.size]), [['true', 2], ['false', 1]]);
  assert.deepStrictEqual(groups[0].items.map((i) => i.title), ['a', 'c']);
  assert.deepStrictEqual(groups[1].items.map((i) => i.title), ['b']);
});

test('group_by_exp on a BARE path buckets by truthiness, not by value', () => {
  // Documented limitation of the simple-expression subset: a bare path is
  // evaluated for TRUTHINESS (evalSimpleExpression's no-operator branch), so
  // Jekyll's `group_by_exp: "item", "item.type"` — which buckets by the value
  // — collapses to one 'true' group here. Comparison expressions are the
  // supported form; pinned so a future widening of the subset is a deliberate,
  // visible change rather than a silent one.
  const items = [
    { type: 'post', title: 'a' },
    { type: 'page', title: 'b' },
    { title: 'c' },
  ];

  const groups = compat.groupByExp(items, 'item', 'item.type');

  assert.deepStrictEqual(groups.map((g) => [g.name, g.size]), [['true', 2], ['false', 1]]);
});

test('COMPAT_NAMES maps the Jekyll filter names onto the implementations', () => {
  assert.deepStrictEqual(Object.keys(compat.COMPAT_NAMES).sort(), [
    'date_to_rfc822',
    'date_to_xmlschema',
    'group_by_exp',
    'jsonify',
    'number_of_words',
    'slugify',
    'strip_html',
    'where_exp',
  ]);
  assert.strictEqual(compat.COMPAT_NAMES.slugify, compat.slugify);
  assert.strictEqual(compat.COMPAT_NAMES.strip_html, compat.stripHtml);
});
