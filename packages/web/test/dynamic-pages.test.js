/**
 * dynamic-pages.js — the generated listing/category pages of a brand's own
 * collections (#207, `targets.web.collections`):
 *  1. the config read: a built-in collection name, a missing/bad field, a bad
 *     size or permalink are ERRORS — a collection that silently fails to
 *     register generates no pages, and an empty section of a site reads
 *     exactly like an unwritten one
 *  2. the defaults: name → title, dir, taxonomy, page size
 *  3. dev sampling accepts a declared collection by name
 *  4. through the real engine: the collections fixture ships the listing, its
 *     pagination and one page per category at the URL contract, with the
 *     documents themselves under the same base — and a consumer page at any of
 *     those permalinks takes the URL over
 */
const assert = require('node:assert');
const path = require('node:path');
const { test, before } = require('node:test');

const { buildSite, PKG } = require('./lib/build.js');
const { readCollections } = require('../src/dynamic-pages.js');
const { readLimits } = require('../src/limit-collections.js');

const FIXTURE = path.join(PKG, 'test', 'fixtures', 'collections-site');
const SITE_DATA = require(path.join(FIXTURE, 'site-data.json'));

// The fixture's four documents, URL-ascending (the order a brand collection
// lists in), across two categories.
const DOCS = ['/docs/api', '/docs/cli', '/docs/faq', '/docs/getting-started'];

const build = (collections, name) => buildSite(FIXTURE, { ...SITE_DATA, collections }, {}, name);

test('an unset key declares nothing', () => {
  assert.deepStrictEqual(readCollections(undefined), []);
  assert.deepStrictEqual(readCollections(null), []);
});

test('a built-in collection name is a hard error — those bring their own pages', () => {
  assert.throws(
    () => readCollections({ posts: { field: 'post.categories' } }),
    /targets\.web\.collections\.posts is already an OMEGA collection — the built-in collections are posts, alternatives, team, updates/,
  );
  assert.throws(() => readCollections({ team: { field: 'member.role' } }), /already an OMEGA collection/);
});

test('the field is required — it is what the category pages group on', () => {
  assert.throws(() => readCollections({ docs: {} }), /targets\.web\.collections\.docs\.field must be the dotted frontmatter path/);
  assert.throws(() => readCollections({ docs: { field: '' } }), /field must be the dotted frontmatter path/);
  assert.throws(() => readCollections({ docs: { field: 'doc category' } }), /got "doc category"/);
  assert.throws(() => readCollections({ docs: { field: ['doc.category'] } }), /field must be the dotted frontmatter path/);
});

test('the shape of the block, the name, and every optional setting is checked', () => {
  assert.throws(() => readCollections([{ docs: {} }]), /must be a map of collection name → settings — got array/);
  assert.throws(() => readCollections({ docs: 'doc.category' }), /must be an object of settings.*got string/);
  assert.throws(() => readCollections({ Docs: { field: 'doc.category' } }), /is not a usable collection name/);
  assert.throws(() => readCollections({ '2docs': { field: 'doc.category' } }), /is not a usable collection name/);
  assert.throws(() => readCollections({ docs: { field: 'doc.category', size: 0 } }), /size must be a positive integer/);
  assert.throws(() => readCollections({ docs: { field: 'doc.category', size: '6' } }), /size must be a positive integer/);
  assert.throws(() => readCollections({ docs: { field: 'doc.category', title: 12 } }), /title must be a string/);
  assert.throws(() => readCollections({ docs: { field: 'doc.category', permalink: 'docs' } }), /permalink must be the collection's URL base/);
  assert.throws(() => readCollections({ docs: { field: 'doc.category', permalink: '/docs/' } }), /permalink must be the collection's URL base/);
});

test('a minimal declaration resolves the whole contract', () => {
  assert.deepStrictEqual(readCollections({ 'case-studies': { field: 'study.industry' } }), [{
    name: 'case-studies',
    dir: '_case-studies',
    base: '/case-studies',
    field: 'study.industry',
    namespace: 'study',
    taxonomy: 'case-studiesCategories',
    size: 6,
    title: 'Case Studies',
    description: 'Browse the Case Studies collection.',
  }]);

  const [docs] = readCollections({ docs: { field: 'category', size: 2, title: 'The Docs', description: 'Read them.', permalink: '/handbook' } });
  assert.strictEqual(docs.base, '/handbook', 'the permalink IS the collection URL base');
  assert.strictEqual(docs.namespace, '', 'a flat field namespaces nothing');
  assert.strictEqual(docs.size, 2);
  assert.strictEqual(docs.title, 'The Docs');
  assert.strictEqual(docs.description, 'Read them.');
});

test('dev sampling accepts a declared collection, and still rejects a typo', () => {
  const collections = readCollections({ docs: { field: 'doc.category' } });

  assert.deepStrictEqual(
    readLimits({ docs: 2 }, collections),
    { entries: [{ name: 'docs', limit: 2 }], randomize: false },
    'a brand samples its own collection like any other',
  );
  assert.throws(() => readLimits({ docs: 2 }), /is not an OMEGA collection — the collections are posts, alternatives, team, updates/);
  assert.throws(() => readLimits({ doc: 2 }, collections), /the collections are posts, alternatives, team, updates, docs/);
});

let pages;
before(async () => {
  pages = await build({
    docs: { field: 'doc.category', size: 2, title: 'The Docs', description: 'Everything, written down.' },
    // Declared, with nothing written yet — the fixture has no _recipes/.
    recipes: { field: 'recipe.cuisine' },
  }, 'dynamic-pages');
});

test('the documents publish under the collection base', () => {
  assert.deepStrictEqual(DOCS.filter((url) => pages.has(url)), DOCS, 'every document, at /<collection>/<slug>');
  assert.ok(pages.get('/docs/api').includes('The API reference.'), 'the document renders its own body');
});

test('the listing paginates at the URL contract', () => {
  const first = pages.get('/docs');
  const second = pages.get('/docs/2');

  assert.ok(first, 'page 1 IS the collection base');
  assert.ok(second, 'page 2 hangs off it');
  assert.ok(!pages.has('/docs/1'), 'page 1 is never also numbered');
  assert.ok(!pages.has('/docs/3'), 'four documents at size 2 is exactly two pages');

  // URL-ascending, two per page — the order a dateless collection reproduces.
  assert.ok(first.includes('The API') && first.includes('The CLI'), 'page 1 lists the first two documents');
  assert.ok(!first.includes('Getting started'), 'and only those two');
  assert.ok(second.includes('FAQ') && second.includes('Getting started'), 'page 2 lists the rest');

  assert.ok(first.includes('<title>The Docs - CollectionsCo</title>'), 'the configured title is the page title');
  assert.ok(first.includes('Everything, written down.'), 'and the description is the standfirst');
  assert.ok(first.includes('href="/docs/2"'), 'page 1 links forward');
  assert.ok(second.includes('href="/docs"'), 'page 2 links back');
});

test('one page per category, keyed by slug', () => {
  const guides = pages.get('/docs/categories/guides');
  const reference = pages.get('/docs/categories/reference');

  assert.ok(guides && reference, 'both terms of the fixture');
  assert.strictEqual(
    [...pages.keys()].filter((url) => url.startsWith('/docs/categories/')).length, 2,
    'the terms are grouped by slug — "Guides" and "guides" are one page',
  );

  assert.ok(guides.includes('The CLI') && guides.includes('Getting started') && guides.includes('FAQ'), 'every document of the term');
  assert.ok(!guides.includes('The API'), 'and none of another term\'s');
  assert.ok(guides.includes('<title>Guides - The Docs - CollectionsCo</title>'), 'the most frequent spelling names the term');
  assert.ok(guides.includes('href="/docs"'), 'and links back to the listing');
});

test('the listing rails the collection\'s own categories', () => {
  const first = pages.get('/docs');

  assert.ok(first.includes('href="/docs/categories/guides"'), 'the Guides rail link');
  assert.ok(first.includes('href="/docs/categories/reference"'), 'the Reference rail link');
});

test('a declared collection with nothing in it still gets its page', () => {
  const empty = pages.get('/recipes');

  assert.ok(empty, 'the listing survives an empty collection — a brand declares it before writing anything');
  assert.ok(empty.includes('Nothing here yet'), 'and says so');
  assert.ok(empty.includes('<title>Recipes - CollectionsCo</title>'), 'the title falls back to the collection name');
  assert.ok(!pages.has('/recipes/2'), 'nothing to paginate');
  assert.strictEqual([...pages.keys()].filter((url) => url.startsWith('/recipes/categories/')).length, 0, 'no documents, no terms, no category pages');
});

test('generated pages stay out of the collections a page that writes no file must stay out of', () => {
  // Paginated templates are excluded in their own raw frontmatter
  // (test/collections-gate.test.js pins the rule): no listing page, no
  // category page, ever reaches the sitemap or the page index.
  const sitemap = pages.get('/sitemap.xml');
  const index = pages.get('/pages.json');

  for (const url of ['/docs', '/docs/2', '/docs/categories/guides']) {
    assert.ok(!sitemap.includes(`${url}<`), `${url} is not a sitemap url`);
    assert.ok(!index.includes(`"${url}"`), `${url} is not a page-index entry`);
  }
  assert.ok(sitemap.includes('/docs/api<'), 'the documents themselves DO ship in the sitemap');
});

test('a consumer page at a generated permalink takes the URL over', async () => {
  // The same collection, based where the fixture's own pages live: one claims
  // the listing, one claims a category page.
  const owned = await build(
    { docs: { field: 'doc.category', size: 2, permalink: '/handbook' } },
    'dynamic-pages-owned',
  );

  assert.ok(owned.get('/handbook').includes('Hand-written handbook listing'), 'the consumer listing page wins');
  assert.ok(!owned.get('/handbook').includes('omega-rowlist'), 'the generated listing wrote no file');

  assert.ok(owned.get('/handbook/categories/guides').includes('Hand-written guides category'), 'the consumer category page wins');
  assert.ok(owned.get('/handbook/categories/reference'), 'and only that one — the rest of the term pages still generate');

  assert.ok(owned.get('/handbook/2'), 'the pagination the consumer did NOT claim still generates');
  assert.ok(owned.has('/handbook/api'), 'and the documents follow the configured base');
});
