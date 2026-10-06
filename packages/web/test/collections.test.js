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
 * template-kit holder mirror the omega_* tags read mid-render.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'collections',
  tests: [
    {
      name: 'every OMEGA collection is registered',
      run: (ctx) => {
        const names = [...registry(new Map()).keys()];

        ctx.expect(names).toEqual([
          'posts',
          'alternatives',
          'team',
          'updates',
          'allByUrl',
          'postCategories',
          'postTags',
        ]);
      },
    },

    {
      name: 'posts sort date-desc, then slug-asc for same-date ties',
      run: (ctx) => {
        const items = [
          post({ slug: 'beta', date: '2024-01-01' }),
          post({ slug: 'newest', date: '2024-06-01' }),
          post({ slug: 'alpha', date: '2024-01-01' }),
        ];

        const posts = registry(new Map()).get('posts')(api(items));

        ctx.expect(posts.map((p) => p.page.fileSlug)).toEqual(['newest', 'alpha', 'beta']);
      },
    },

    {
      name: 'posts mirror into the template-kit holder as Jekyll-style docs',
      run: (ctx) => {
        const holder = new Map();
        const items = [post({ slug: 'hello', url: '/blog/hello/', date: '2024-01-01' })];

        registry(holder).get('posts')(api(items));

        ctx.expect(holder.get('posts')).toEqual([{
          // Trailing slashes stripped — the id shape omega_post matches on.
          id: '/blog/hello',
          url: '/blog/hello/',
          date: new Date('2024-01-01'),
          data: items[0].data,
        }]);
      },
    },

    {
      name: 'a url-less doc falls back to its inputPath as the id',
      run: (ctx) => {
        const holder = new Map();
        const item = {
          tags: ['team'],
          url: '',
          inputPath: './src/team/ian.md',
          date: new Date('2024-01-01'),
          data: {},
        };

        registry(holder).get('team')(api([item]));

        ctx.expect(holder.get('team')[0].id).toBe('./src/team/ian.md');
      },
    },

    {
      name: 'alternatives and team sort by url ascending; updates descending',
      run: (ctx) => {
        const holder = new Map();
        const collections = registry(holder);
        const make = (tag, url) => ({ tags: [tag], url, inputPath: url, date: new Date(0), data: {} });

        const alternatives = collections.get('alternatives')(
          api([make('alternatives', '/c/'), make('alternatives', '/a/'), make('alternatives', '/b/')]),
        );
        ctx.expect(alternatives.map((d) => d.url)).toEqual(['/a/', '/b/', '/c/']);

        const team = collections.get('team')(
          api([make('team', '/team/zed/'), make('team', '/team/ann/')]),
        );
        ctx.expect(team.map((d) => d.url)).toEqual(['/team/ann/', '/team/zed/']);

        const updates = collections.get('updates')(
          api([make('updates', '/updates/1/'), make('updates', '/updates/3/'), make('updates', '/updates/2/')]),
        );
        ctx.expect(updates.map((d) => d.url)).toEqual(['/updates/3/', '/updates/2/', '/updates/1/']);

        ctx.expect(holder.get('alternatives').map((d) => d.id)).toEqual(['/a', '/b', '/c']);
      },
    },

    {
      name: 'allByUrl sorts by BYTE order, so no ICU build can reorder a sitemap',
      run: (ctx) => {
        const make = (url) => ({ url, inputPath: url, date: new Date(0), data: {} });
        // Uppercase sorts BEFORE lowercase in byte order; localeCompare would not.
        const items = [make('/b/'), make('/A/'), make('/a/'), make('/B/'), { inputPath: 'x', data: {} }];

        const all = registry(new Map()).get('allByUrl')(api(items));

        ctx.expect(all.map((d) => d.url)).toEqual([undefined, '/A/', '/B/', '/a/', '/b/']);
      },
    },

    {
      name: 'taxonomy groups by slug and the most frequent spelling names the term',
      run: (ctx) => {
        const items = [
          post({ slug: 'a', date: '2024-03-01', categories: ['marketing', 'Growth', 'A.I.'] }),
          post({ slug: 'b', date: '2024-02-01', categories: ['Marketing', 'A.I.'] }),
          post({ slug: 'c', date: '2024-01-01', categories: ['marketing', 'a i'] }),
        ];

        const categories = registry(new Map()).get('postCategories')(api(items));

        ctx.expect(categories.map((c) => [c.name, c.slug, c.posts.length])).toEqual([
          // 'A.I.' ×2 beats 'a i' ×1 — punctuation is what still tells two same-slug
          // spellings apart once the winner humanizes (#457). Sorted by display name.
          ['A.i.', 'a-i', 3],
          ['Growth', 'growth', 1],
          ['Marketing', 'marketing', 3],
        ]);
        ctx.expect(categories.find((c) => c.slug === 'marketing').posts.map((p) => p.page.fileSlug), 'term posts keep the date-desc post order').toEqual(['a', 'b', 'c']);
      },
    },

    {
      name: 'a term DISPLAYS humanized — hyphens are word breaks, legacy UJM parity (#457)',
      run: (ctx) => {
        // The clockii regressions, verbatim: legacy UJM's blog-taxonomy generator
        // titleized every term it named a page after, so a migrating brand's
        // taxonomy titles must not drift. The URL (slug) never moves.
        const items = [
          post({ slug: 'a', date: '2024-03-01', tags: ['time-tracking-tools'] }),
          post({ slug: 'b', date: '2024-02-01', tags: ['employee-well-being'] }),
          post({ slug: 'c', date: '2024-01-01', tags: ['work-life-balance'] }),
        ];

        const tags = registry(new Map()).get('postTags')(api(items));

        ctx.expect(tags.map((t) => [t.name, t.slug])).toEqual([
          ['Employee Well Being', 'employee-well-being'],
          ['Time Tracking Tools', 'time-tracking-tools'],
          ['Work Life Balance', 'work-life-balance'],
        ]);
      },
    },

    {
      name: 'an apostrophe term keeps its UJM slug — deleted, never a separator (#597)',
      run: (ctx) => {
        // soundgrail's live categories: UJM published `beginners-guides`, and a
        // slugifier that separates on the apostrophe moves the URL to
        // `beginner-s-guides`. Straight and typographic spellings are ONE term —
        // the markdown typographer smartens the straight one at build time.
        const items = [
          post({ slug: 'a', date: '2024-03-01', categories: ["Beginner's Guides"] }),
          post({ slug: 'b', date: '2024-02-01', categories: ['Beginner’s Guides'] }),
          post({ slug: 'c', date: '2024-01-01', categories: ["Beginner's Music Guide"] }),
        ];

        const categories = registry(new Map()).get('postCategories')(api(items));

        ctx.expect(categories.map((c) => [c.slug, c.posts.length])).toEqual([
          ['beginners-guides', 2],
          ['beginners-music-guide', 1],
        ]);
      },
    },

    {
      name: 'underscores break words too, and separator RUNS collapse (#457)',
      run: (ctx) => {
        const items = [
          post({ slug: 'a', date: '2024-02-01', categories: ['product_updates'] }),
          // Legacy shipped two spellings of titleize and they disagree only here
          // (blog-taxonomy.rb left a double space, dynamic-pages.rb did not) — a
          // double space in a <title> is an artifact, so runs collapse.
          post({ slug: 'b', date: '2024-01-01', categories: ['ai --_ ops'] }),
        ];

        const categories = registry(new Map()).get('postCategories')(api(items));

        ctx.expect(categories.map((c) => c.name)).toEqual(['Ai Ops', 'Product Updates']);
      },
    },

    {
      name: 'a post never lands in the same term twice, however it spells it',
      run: (ctx) => {
        const items = [post({ slug: 'a', date: '2024-01-01', tags: ['AI', 'ai', 'A.I.'] })];

        const tags = registry(new Map()).get('postTags')(api(items));

        ctx.expect(tags.map((t) => [t.name, t.slug, t.posts.length])).toEqual([
          ['A.i.', 'a-i', 1],
          ['Ai', 'ai', 1],
        ]);
      },
    },

    {
      name: 'unslugifiable and absent taxonomy values contribute no terms',
      run: (ctx) => {
        const items = [
          post({ slug: 'a', date: '2024-01-01', categories: ['---', ''] }),
          post({ slug: 'b', date: '2024-01-02' }),
        ];

        ctx.expect(registry(new Map()).get('postCategories')(api(items))).toEqual([]);
        ctx.expect(registry(new Map()).get('postTags')(api(items))).toEqual([]);
      },
    },
  ],
});
