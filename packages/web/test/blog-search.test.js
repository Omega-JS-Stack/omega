/**
 * Blog search without a third-party widget: the build emits /blog/index.json
 * (title, description, date, taxonomy — no post bodies) and the blog index
 * page carries a plain labeled input plus the region the page module renders
 * results into. The Google CSE form both themes used to submit to is gone.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');

const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

const SEARCH_MODULE = path.join(PKG, 'core', 'js', 'pages', 'blog', '_search.mjs');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'blog-search-test');
const buildNf = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'blog-search-nf-test');

let pages;
before(async () => {
  pages = await buildWith(miniData);
});

test('/blog/index.json: every post, newest first, index fields only', () => {
  const index = JSON.parse(pages.get('/blog/index.json'));

  assert.strictEqual(index.length, 17, 'every fixture post is indexed');
  assert.deepStrictEqual(Object.keys(index[0]).sort(), ['categories', 'date', 'desc', 'tags', 'title', 'url'], 'index fields');

  const first = index.find((entry) => entry.title === 'First post');
  assert.ok(first, 'the fixture post is in the index');
  assert.strictEqual(first.url, '/blog/first-post', 'site-relative url');
  assert.strictEqual(first.desc, 'The first mini post', 'description carried');
  assert.strictEqual(first.date, '2024-01-15', 'machine date');
  assert.deepStrictEqual(first.categories, ['Growth'], 'categories carried');
  assert.deepStrictEqual(first.tags, ['automation', 'growth-hacks', 'A&R'], 'tags carried');

  // Newest first (the posts collection order), so a query's ties read newest first
  assert.strictEqual(index[0].title, 'Second post', 'newest post leads');

  // No bodies: the index stays small on any blog
  const body = pages.get('/blog/first-post');
  assert.ok(body.includes('Alpha bravo charlie'), 'the post body exists on the post page');
  assert.ok(!pages.get('/blog/index.json').includes('Alpha bravo charlie'), 'post bodies never enter the index');
  assert.ok(index.every((entry) => entry.desc.length <= 184), 'descriptions capped');
});

test('/blog/index.json: machine file, out of the sitemap and the page index', () => {
  assert.ok(!pages.get('/sitemap.xml').includes('/blog/index.json'), 'not a sitemap url');
  assert.ok(!pages.get('/pages.json').includes('/blog/index.json'), 'not a search hit');
});

test('classy blog index: labeled search input + results region, no CSE form', () => {
  const blog = pages.get('/blog');

  assert.ok(blog.includes('id="blog-search"'), 'the search input the module binds');
  assert.ok(blog.includes('<label for="blog-search" class="visually-hidden">Search posts</label>'), 'the input carries a real label');
  assert.ok(blog.includes('id="blog-search-results"'), 'results region');
  assert.ok(blog.includes('aria-live="polite"'), 'results announce themselves');
  assert.ok(blog.includes('data-blog-listing'), 'the listing the results replace');

  assert.ok(!blog.includes('search/cse'), 'the Google CSE endpoint is gone');
  assert.ok(!blog.includes('cse.google'), 'no CSE widget');
  assert.ok(!/<form[^>]*q[^>]*>[\s\S]{0,400}id="blog-search"/.test(blog), 'the input no longer submits anywhere');
});

test('classy blog pagination pages carry the same search surface', () => {
  const page2 = pages.get('/blog/page/2');

  assert.ok(page2.includes('id="blog-search"'), 'search input on page 2');
  assert.ok(page2.includes('id="blog-search-results"'), 'results region on page 2');
  assert.ok(!page2.includes('search/cse'), 'no CSE endpoint on page 2');
});

test('the site search endpoints point at the blog, not at Google', () => {
  const blog = pages.get('/blog');
  const opensearch = pages.get('/opensearch.xml');

  assert.ok(blog.includes('"target": "https://mini.example.com/blog?q={search_term_string}"'), 'SearchAction targets the blog');
  assert.ok(opensearch.includes('template="https://mini.example.com/blog?q={searchTerms}"'), 'OpenSearch targets the blog');
});

test('ranking: every token must match, title hits first, newest breaks ties', async () => {
  const { search, formatDate } = await import(SEARCH_MODULE);
  const index = [
    { title: 'Naming things', desc: 'A survival guide', date: '2026-03-02', categories: ['Craft'], tags: ['writing'] },
    { title: 'Release notes people read', desc: 'How to write a changelog', date: '2026-02-01', categories: ['Company'], tags: ['writing', 'docs'] },
    { title: 'Deploys on Friday', desc: 'Naming your release branches', date: '2026-01-01', categories: ['Ops'], tags: [] },
  ];

  // Title hit outranks a description hit for the same word
  assert.deepStrictEqual(search(index, 'naming').map((e) => e.title), ['Naming things', 'Deploys on Friday']);

  // Case-insensitive, and taxonomy is searchable
  assert.deepStrictEqual(search(index, 'WRITING').map((e) => e.title), ['Naming things', 'Release notes people read']);

  // Multi-token is AND across the whole entry, not one field
  assert.deepStrictEqual(search(index, 'release notes').map((e) => e.title), ['Release notes people read']);
  assert.deepStrictEqual(search(index, 'naming changelog'), [], 'a token nothing matches drops the entry');

  // Equal scores keep index order, which is newest first
  assert.deepStrictEqual(search(index, 'writing').map((e) => e.title), ['Naming things', 'Release notes people read']);

  assert.deepStrictEqual(search(index, '   '), [], 'a whitespace query matches nothing');
  assert.strictEqual(formatDate('2026-03-02'), 'Mar 2, 2026', 'dates read as authored (UTC)');
  assert.strictEqual(formatDate(''), '', 'a dateless entry renders no meta');
});

test('index loading: one fetch on success, no cached failure on a dead index', async () => {
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

    assert.strictEqual(await load(), null, 'a 404 resolves null');
    assert.strictEqual(await load(), null, 'a parse failure resolves null');
    assert.deepStrictEqual(await load(), [{ title: 'First post' }], 'the retry after a failure gets the real index');
    assert.strictEqual(calls.length, 3, 'each failure re-fetched — the rejection was never cached');

    assert.deepStrictEqual(await load(), [{ title: 'First post' }], 'a successful load is reused');
    assert.strictEqual(calls.length, 3, 'success IS cached — one fetch per visitor');

    assert.strictEqual(errors.length, 2, 'both failures logged through the page logger');
    assert.ok(errors[0].includes('/blog/index.json'), 'the log names the index it could not load');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the blog module renders an unavailable state instead of a false "no results"', () => {
  const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'blog', 'index.js'), 'utf8');

  assert.ok(source.includes('Search is unavailable right now.'), 'the honest failure copy');
  assert.ok(source.includes('renderUnavailable($results, $listing)'), 'the run loop renders it when the index is missing');
});

test('newsflash blog index mirrors the search surface', async () => {
  const nf = await buildNf({ ...miniData, theme: { id: 'newsflash' } });
  const blog = nf.get('/blog');

  assert.ok(blog.includes('id="blog-search"'), 'the search input');
  assert.ok(blog.includes('<label for="blog-search" class="visually-hidden">Search posts</label>'), 'labeled');
  assert.ok(blog.includes('id="blog-search-results"'), 'results region');
  assert.ok(blog.includes('data-blog-listing'), 'the listing the results replace');
  assert.ok(!blog.includes('search/cse'), 'the Google CSE endpoint is gone');

  assert.ok(JSON.parse(nf.get('/blog/index.json')).length === 17, 'the index is theme-independent');
});
