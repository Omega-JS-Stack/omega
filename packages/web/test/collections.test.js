/**
 * collections.js — the content collections and the blog taxonomy, driven
 * through a stand-in for the Eleventy collection API (the module's own
 * injection seam: `eleventyConfig.addCollection(name, fn)` plus the `api`
 * the callback receives).
 *
 * The invariants that matter are all ORDERING and IDENTITY invariants a
 * built site cannot show you cheaply: date-desc/slug-asc post order,
 * byte-order (not locale) URL sort for the meta-file lane, taxonomy keyed by
 * SLUG with the most-frequent spelling winning the display name, and the
 * template-kit holder mirror the uj_* tags read mid-render.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { registerCollections } = require('../src/collections.js');

// Stand-in for the Eleventy config: collect the registered callbacks.
function registry(holder) {
  const collections = new Map();
  registerCollections({ addCollection: (name, fn) => collections.set(name, fn) }, holder);
  return collections;
}

// Stand-in for the Eleventy collection API over a fixed list of items.
function api(items) {
  return {
    getAll: () => [...items],
    getFilteredByTag: (tag) => items.filter((item) => (item.tags || []).includes(tag)),
  };
}

function post({ slug, url, date, categories, tags }) {
  return {
    tags: ['posts'],
    url: url || `/blog/${slug}/`,
    inputPath: `./src/_posts/${slug}.md`,
    date: new Date(date),
    data: { post: { categories, tags } },
    page: { fileSlug: slug },
  };
}

test('every OMEGA collection is registered', () => {
  const names = [...registry(new Map()).keys()];

  assert.deepStrictEqual(names, [
    'posts',
    'alternatives',
    'team',
    'updates',
    'allByUrl',
    'postCategories',
    'postTags',
  ]);
});

test('posts sort date-desc, then slug-asc for same-date ties', () => {
  const items = [
    post({ slug: 'beta', date: '2024-01-01' }),
    post({ slug: 'newest', date: '2024-06-01' }),
    post({ slug: 'alpha', date: '2024-01-01' }),
  ];

  const posts = registry(new Map()).get('posts')(api(items));

  assert.deepStrictEqual(posts.map((p) => p.page.fileSlug), ['newest', 'alpha', 'beta']);
});

test('posts mirror into the template-kit holder as Jekyll-style docs', () => {
  const holder = new Map();
  const items = [post({ slug: 'hello', url: '/blog/hello/', date: '2024-01-01' })];

  registry(holder).get('posts')(api(items));

  assert.deepStrictEqual(holder.get('posts'), [{
    // Trailing slashes stripped — the id shape uj_post matches on.
    id: '/blog/hello',
    url: '/blog/hello/',
    date: new Date('2024-01-01'),
    data: items[0].data,
  }]);
});

test('a url-less doc falls back to its inputPath as the id', () => {
  const holder = new Map();
  const item = {
    tags: ['team'],
    url: '',
    inputPath: './src/team/ian.md',
    date: new Date('2024-01-01'),
    data: {},
  };

  registry(holder).get('team')(api([item]));

  assert.strictEqual(holder.get('team')[0].id, './src/team/ian.md');
});

test('alternatives and team sort by url ascending; updates descending', () => {
  const holder = new Map();
  const collections = registry(holder);
  const make = (tag, url) => ({ tags: [tag], url, inputPath: url, date: new Date(0), data: {} });

  const alternatives = collections.get('alternatives')(
    api([make('alternatives', '/c/'), make('alternatives', '/a/'), make('alternatives', '/b/')]),
  );
  assert.deepStrictEqual(alternatives.map((d) => d.url), ['/a/', '/b/', '/c/']);

  const team = collections.get('team')(
    api([make('team', '/team/zed/'), make('team', '/team/ann/')]),
  );
  assert.deepStrictEqual(team.map((d) => d.url), ['/team/ann/', '/team/zed/']);

  const updates = collections.get('updates')(
    api([make('updates', '/updates/1/'), make('updates', '/updates/3/'), make('updates', '/updates/2/')]),
  );
  assert.deepStrictEqual(updates.map((d) => d.url), ['/updates/3/', '/updates/2/', '/updates/1/']);

  assert.deepStrictEqual(holder.get('alternatives').map((d) => d.id), ['/a', '/b', '/c']);
});

test('allByUrl sorts by BYTE order, so no ICU build can reorder a sitemap', () => {
  const make = (url) => ({ url, inputPath: url, date: new Date(0), data: {} });
  // Uppercase sorts BEFORE lowercase in byte order; localeCompare would not.
  const items = [make('/b/'), make('/A/'), make('/a/'), make('/B/'), { inputPath: 'x', data: {} }];

  const all = registry(new Map()).get('allByUrl')(api(items));

  assert.deepStrictEqual(all.map((d) => d.url), [undefined, '/A/', '/B/', '/a/', '/b/']);
});

test('taxonomy groups by slug and the most frequent spelling names the term', () => {
  const items = [
    post({ slug: 'a', date: '2024-03-01', categories: ['marketing', 'Growth'] }),
    post({ slug: 'b', date: '2024-02-01', categories: ['Marketing'] }),
    post({ slug: 'c', date: '2024-01-01', categories: ['marketing'] }),
  ];

  const categories = registry(new Map()).get('postCategories')(api(items));

  assert.deepStrictEqual(categories.map((c) => [c.name, c.slug, c.posts.length]), [
    // 'marketing' ×2 beats 'Marketing' ×1; sorted by display name.
    ['Growth', 'growth', 1],
    ['marketing', 'marketing', 3],
  ]);
  assert.deepStrictEqual(
    categories.find((c) => c.slug === 'marketing').posts.map((p) => p.page.fileSlug),
    ['a', 'b', 'c'],
    'term posts keep the date-desc post order',
  );
});

test('a post never lands in the same term twice, however it spells it', () => {
  const items = [post({ slug: 'a', date: '2024-01-01', tags: ['AI', 'ai', 'A.I.'] })];

  const tags = registry(new Map()).get('postTags')(api(items));

  assert.deepStrictEqual(tags.map((t) => [t.name, t.slug, t.posts.length]), [
    ['A.I.', 'a-i', 1],
    ['AI', 'ai', 1],
  ]);
});

test('unslugifiable and absent taxonomy values contribute no terms', () => {
  const items = [
    post({ slug: 'a', date: '2024-01-01', categories: ['---', ''] }),
    post({ slug: 'b', date: '2024-01-02' }),
  ];

  assert.deepStrictEqual(registry(new Map()).get('postCategories')(api(items)), []);
  assert.deepStrictEqual(registry(new Map()).get('postTags')(api(items)), []);
});
