/**
 * Blog search without a third-party widget: the build emits /blog/index.json
 * (title, description, date, taxonomy — no post bodies) and the blog index
 * page carries a plain labeled input plus the region the page module renders
 * results into. The Google CSE form both themes used to submit to is gone.
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const SEARCH_MODULE = path.join(PKG, 'core', 'js', 'pages', 'blog', '_search.mjs');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'blog-search-test');
const buildNf = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'blog-search-nf-test');

let pages;

module.exports = defineCases({
  type: 'group',
  description: 'blog-search',
  setup: async () => {
    pages = await buildWith(miniData);
  },
  tests: [
    {
      name: '/blog/index.json: every post, newest first, index fields only',
      run: (ctx) => {
        const index = JSON.parse(pages.get('/blog/index.json'));

        ctx.expect(index.length, 'every fixture post is indexed').toBe(17);
        ctx.expect(Object.keys(index[0]).sort(), 'index fields').toEqual(['categories', 'date', 'desc', 'tags', 'title', 'url']);

        const first = index.find((entry) => entry.title === 'First post');
        ctx.expect(first, 'the fixture post is in the index').toBeTruthy();
        ctx.expect(first.url, 'site-relative url').toBe('/blog/first-post');
        ctx.expect(first.desc, 'description carried').toBe('The first mini post');
        ctx.expect(first.date, 'machine date').toBe('2024-01-15');
        ctx.expect(first.categories, 'categories carried').toEqual(['Growth']);
        ctx.expect(first.tags, 'tags carried').toEqual(['automation', 'growth-hacks', 'A&R']);

        // Newest first (the posts collection order), so a query's ties read newest first
        ctx.expect(index[0].title, 'newest post leads').toBe('Second post');

        // No bodies: the index stays small on any blog
        const body = pages.get('/blog/first-post');
        ctx.expect(body.includes('Alpha bravo charlie'), 'the post body exists on the post page').toBeTruthy();
        ctx.expect(!pages.get('/blog/index.json').includes('Alpha bravo charlie'), 'post bodies never enter the index').toBeTruthy();
        ctx.expect(index.every((entry) => entry.desc.length <= 184), 'descriptions capped').toBeTruthy();
      },
    },

    {
      name: '/blog/index.json: machine file, out of the sitemap and the page index',
      run: (ctx) => {
        ctx.expect(!pages.get('/sitemap.xml').includes('/blog/index.json'), 'not a sitemap url').toBeTruthy();
        ctx.expect(!pages.get('/pages.json').includes('/blog/index.json'), 'not a search hit').toBeTruthy();
      },
    },

    {
      name: 'classy blog index: labeled search input + results region, no CSE form',
      run: (ctx) => {
        const blog = pages.get('/blog');

        ctx.expect(blog.includes('id="blog-search"'), 'the search input the module binds').toBeTruthy();
        ctx.expect(blog.includes('<label for="blog-search" class="visually-hidden">Search posts</label>'), 'the input carries a real label').toBeTruthy();
        ctx.expect(blog.includes('id="blog-search-results"'), 'results region').toBeTruthy();
        ctx.expect(blog.includes('aria-live="polite"'), 'results announce themselves').toBeTruthy();
        ctx.expect(blog.includes('data-blog-listing'), 'the listing the results replace').toBeTruthy();

        ctx.expect(!blog.includes('search/cse'), 'the Google CSE endpoint is gone').toBeTruthy();
        ctx.expect(!blog.includes('cse.google'), 'no CSE widget').toBeTruthy();
        ctx.expect(!/<form[^>]*q[^>]*>[\s\S]{0,400}id="blog-search"/.test(blog), 'the input no longer submits anywhere').toBeTruthy();
      },
    },

    {
      name: 'classy blog pagination pages carry the same search surface',
      run: (ctx) => {
        const page2 = pages.get('/blog/page/2');

        ctx.expect(page2.includes('id="blog-search"'), 'search input on page 2').toBeTruthy();
        ctx.expect(page2.includes('id="blog-search-results"'), 'results region on page 2').toBeTruthy();
        ctx.expect(!page2.includes('search/cse'), 'no CSE endpoint on page 2').toBeTruthy();
      },
    },

    {
      name: 'the site search endpoints point at the blog, not at Google',
      run: (ctx) => {
        const blog = pages.get('/blog');
        const opensearch = pages.get('/opensearch.xml');

        ctx.expect(blog.includes('"target": "https://mini.example.com/blog?q={search_term_string}"'), 'SearchAction targets the blog').toBeTruthy();
        ctx.expect(opensearch.includes('template="https://mini.example.com/blog?q={searchTerms}"'), 'OpenSearch targets the blog').toBeTruthy();
      },
    },

    {
      name: 'ranking: every token must match, title hits first, newest breaks ties',
      run: async (ctx) => {
        const { search, formatDate } = await import(SEARCH_MODULE);
        const index = [
          { title: 'Naming things', desc: 'A survival guide', date: '2026-03-02', categories: ['Craft'], tags: ['writing'] },
          { title: 'Release notes people read', desc: 'How to write a changelog', date: '2026-02-01', categories: ['Company'], tags: ['writing', 'docs'] },
          { title: 'Deploys on Friday', desc: 'Naming your release branches', date: '2026-01-01', categories: ['Ops'], tags: [] },
        ];

        // Title hit outranks a description hit for the same word
        ctx.expect(search(index, 'naming').map((e) => e.title)).toEqual(['Naming things', 'Deploys on Friday']);

        // Case-insensitive, and taxonomy is searchable
        ctx.expect(search(index, 'WRITING').map((e) => e.title)).toEqual(['Naming things', 'Release notes people read']);

        // Multi-token is AND across the whole entry, not one field
        ctx.expect(search(index, 'release notes').map((e) => e.title)).toEqual(['Release notes people read']);
        ctx.expect(search(index, 'naming changelog'), 'a token nothing matches drops the entry').toEqual([]);

        // Equal scores keep index order, which is newest first
        ctx.expect(search(index, 'writing').map((e) => e.title)).toEqual(['Naming things', 'Release notes people read']);

        ctx.expect(search(index, '   '), 'a whitespace query matches nothing').toEqual([]);
        ctx.expect(formatDate('2026-03-02'), 'dates read as authored (UTC)').toBe('Mar 2, 2026');
        ctx.expect(formatDate(''), 'a dateless entry renders no meta').toBe('');
      },
    },

    {
      name: 'index loading: one fetch on success, no cached failure on a dead index',
      run: async (ctx) => {
        const { createIndexLoader } = await import(SEARCH_MODULE);
        const errors = [];
        const logger = { log: () => {}, error: (...args) => errors.push(args.join(' ')) };

        const responses = [];
        const originalFetch = globalThis.fetch;
        const calls = [];
        globalThis.fetch = async (url) => {
          calls.push(url);
          return responses.shift()();
        };

        try {
          // A 404 resolves null (never an unhandled rejection) and is NOT cached
          responses.push(() => ({ ok: false, status: 404, json: async () => ({}) }));
          // A body that isn't JSON rejects in parse — same treatment
          responses.push(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
          responses.push(() => ({ ok: true, status: 200, json: async () => [{ title: 'First post' }] }));

          const load = createIndexLoader('/blog/index.json', logger);

          ctx.expect(await load(), 'a 404 resolves null').toBe(null);
          ctx.expect(await load(), 'a parse failure resolves null').toBe(null);
          ctx.expect(await load(), 'the retry after a failure gets the real index').toEqual([{ title: 'First post' }]);
          ctx.expect(calls.length, 'each failure re-fetched — the rejection was never cached').toBe(3);

          ctx.expect(await load(), 'a successful load is reused').toEqual([{ title: 'First post' }]);
          ctx.expect(calls.length, 'success IS cached — one fetch per visitor').toBe(3);

          ctx.expect(errors.length, 'both failures logged through the page logger').toBe(2);
          ctx.expect(errors[0].includes('/blog/index.json'), 'the log names the index it could not load').toBeTruthy();
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    },

    {
      name: 'the blog module renders an unavailable state instead of a false "no results"',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'blog', 'index.js'), 'utf8');

        ctx.expect(source.includes('Search is unavailable right now.'), 'the honest failure copy').toBeTruthy();
        ctx.expect(source.includes('renderUnavailable($results, $listing)'), 'the run loop renders it when the index is missing').toBeTruthy();
      },
    },

    {
      name: 'newsflash blog index mirrors the search surface',
      run: async (ctx) => {
        const nf = await buildNf({ ...miniData, theme: { id: 'newsflash' } });
        const blog = nf.get('/blog');

        ctx.expect(blog.includes('id="blog-search"'), 'the search input').toBeTruthy();
        ctx.expect(blog.includes('<label for="blog-search" class="visually-hidden">Search posts</label>'), 'labeled').toBeTruthy();
        ctx.expect(blog.includes('id="blog-search-results"'), 'results region').toBeTruthy();
        ctx.expect(blog.includes('data-blog-listing'), 'the listing the results replace').toBeTruthy();
        ctx.expect(!blog.includes('search/cse'), 'the Google CSE endpoint is gone').toBeTruthy();

        ctx.expect(JSON.parse(nf.get('/blog/index.json')).length === 17, 'the index is theme-independent').toBeTruthy();
      },
    },
  ],
});
