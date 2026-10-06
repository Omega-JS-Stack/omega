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
 *  5. every generated page carries its OWN meta — a category page that falls
 *     back to the site title/description is indexable duplication (#312)
 *  6. and so does every DOCUMENT, which also opens with its own h1 (#317)
 */
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, PKG } = require('./lib/build.js');
const { readCollections, applyDocumentData } = require('../src/dynamic-pages.js');
const { readLimits } = require('../src/limit-collections.js');

const FIXTURE = path.join(PKG, 'test', 'fixtures', 'collections-site');
const SITE_DATA = require(path.join(FIXTURE, 'site-data.json'));

// The fixture's four documents, URL-ascending (the order a brand collection
// lists in), across two categories.
const DOCS = ['/docs/api', '/docs/cli', '/docs/faq', '/docs/getting-started'];

const build = (collections, name) => buildSite(FIXTURE, { ...SITE_DATA, collections }, {}, name);

/**
 * The head values a page shipped.
 * @param {string} html
 * @returns {{ title: string, description: string }}
 */
function head(html) {
  return {
    title: (html.match(/<title>([^<]*)<\/title>/) || [])[1],
    description: (html.match(/<meta name="description" content="([^"]*)"/) || [])[1],
  };
}

let pages;

module.exports = defineCases({
  type: 'group',
  description: 'dynamic-pages',
  setup: async () => {
    pages = await build({
      docs: { field: 'doc.category', size: 2, title: 'The Docs', description: 'Everything, written down.' },
      // Declared, with nothing written yet — the fixture has no _recipes/.
      recipes: { field: 'recipe.cuisine' },
    }, 'dynamic-pages');
  },
  tests: [
    {
      name: 'an unset key declares nothing',
      run: (ctx) => {
        ctx.expect(readCollections(undefined)).toEqual([]);
        ctx.expect(readCollections(null)).toEqual([]);
      },
    },

    {
      name: 'a built-in collection name is a hard error — those bring their own pages',
      run: (ctx) => {
        ctx.expect(() => readCollections({ posts: { field: 'post.categories' } })).toThrow(/targets\.web\.collections\.posts is already an OMEGA collection — the built-in collections are posts, alternatives, team, updates/);
        ctx.expect(() => readCollections({ team: { field: 'member.role' } })).toThrow(/already an OMEGA collection/);
      },
    },

    {
      name: 'a reserved name is a hard error too — a site build fact, or a config section (#593)',
      run: (ctx) => {
        // A declared collection publishes as `site.<name>` (#593), so a name the
        // build already owns silently WIPES that fact: `pricing` replaces the payment
        // view-model with [], `data` the json-in-_includes system, `targets` the
        // curated view. `time`/`omega`/`characters` are not even arrays, so the sync
        // crashes the build later with "push is not a function".
        ctx.expect(() => readCollections({ pricing: { field: 'plan.tier' } })).toThrow(/targets\.web\.collections\.pricing is already a site build fact — .*\bpricing\b.*Name your collection something else\./s);
        ctx.expect(() => readCollections({ data: { field: 'row.kind' } })).toThrow(/already a site build fact/);
        ctx.expect(() => readCollections({ time: { field: 'slot.day' } })).toThrow(/already a site build fact/);

        // And a name a config section already owns hard-fails the #611 dead-read
        // guard on the collection's OWN `{% for r in site.reviews %}` — with advice
        // (spell it `resolved.config.reviews`) that cannot fix it.
        ctx.expect(() => readCollections({ reviews: { field: 'review.product' } })).toThrow(/targets\.web\.collections\.reviews is already a config section — .*resolved\.config\.reviews.*Name your collection something else\./s);
        ctx.expect(() => readCollections({ directory: { field: 'listing.category' } })).toThrow(/already a config section/);
        ctx.expect(() => readCollections({ blog: { field: 'entry.tag' } })).toThrow(/already a config section/);
      },
    },

    {
      name: 'the field is required — it is what the category pages group on',
      run: (ctx) => {
        ctx.expect(() => readCollections({ docs: {} })).toThrow(/targets\.web\.collections\.docs\.field must be the dotted frontmatter path/);
        ctx.expect(() => readCollections({ docs: { field: '' } })).toThrow(/field must be the dotted frontmatter path/);
        ctx.expect(() => readCollections({ docs: { field: 'doc category' } })).toThrow(/got "doc category"/);
        ctx.expect(() => readCollections({ docs: { field: ['doc.category'] } })).toThrow(/field must be the dotted frontmatter path/);
      },
    },

    {
      name: 'the shape of the block, the name, and every optional setting is checked',
      run: (ctx) => {
        ctx.expect(() => readCollections([{ docs: {} }])).toThrow(/must be a map of collection name → settings — got array/);
        ctx.expect(() => readCollections({ docs: 'doc.category' })).toThrow(/must be an object of settings.*got string/);
        ctx.expect(() => readCollections({ Docs: { field: 'doc.category' } })).toThrow(/is not a usable collection name/);
        ctx.expect(() => readCollections({ '2docs': { field: 'doc.category' } })).toThrow(/is not a usable collection name/);
        ctx.expect(() => readCollections({ docs: { field: 'doc.category', size: 0 } })).toThrow(/size must be a positive integer/);
        ctx.expect(() => readCollections({ docs: { field: 'doc.category', size: '6' } })).toThrow(/size must be a positive integer/);
        ctx.expect(() => readCollections({ docs: { field: 'doc.category', title: 12 } })).toThrow(/title must be a string/);
        ctx.expect(() => readCollections({ docs: { field: 'doc.category', permalink: 'docs' } })).toThrow(/permalink must be the collection's URL base/);
        ctx.expect(() => readCollections({ docs: { field: 'doc.category', permalink: '/docs/' } })).toThrow(/permalink must be the collection's URL base/);
      },
    },

    {
      name: 'a minimal declaration resolves the whole contract',
      run: (ctx) => {
        ctx.expect(readCollections({ 'case-studies': { field: 'study.industry' } })).toEqual([{
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
        ctx.expect(docs.base, 'the permalink IS the collection URL base').toBe('/handbook');
        ctx.expect(docs.namespace, 'a flat field namespaces nothing').toBe('');
        ctx.expect(docs.size).toBe(2);
        ctx.expect(docs.title).toBe('The Docs');
        ctx.expect(docs.description).toBe('Read them.');
      },
    },

    {
      name: 'a document names itself even when it wrote nothing to name itself with (#317)',
      run: (ctx) => {
        const [docs] = readCollections({ docs: { field: 'doc.category' } });
        const bare = { page: { fileSlug: 'getting-started' } };
        applyDocumentData(docs, bare, 'CollectionsCo');

        // Last resort, and still never the site's: the slug is the document's name.
        ctx.expect(bare.meta.title).toBe('Getting Started - Docs - CollectionsCo');
        ctx.expect(bare.meta.description).toBe('Read Getting Started in the Docs collection.');
        ctx.expect(bare.collection.base, 'and the layout gets the collection block').toBe('/docs');
        ctx.expect(bare.title, 'the h1 headline agrees with the derived title, never the collection\'s').toBe('Getting Started');

        // What the document DID write always wins.
        const owned = {
          page: { fileSlug: 'getting-started' },
          doc: { title: 'Getting started', description: 'Install it.' },
          meta: { title: 'Start here' },
        };
        applyDocumentData(docs, owned, 'CollectionsCo');
        ctx.expect(owned.meta.title, 'an explicit meta.title is never rewritten').toBe('Start here');
        ctx.expect(owned.meta.description, 'and the document\'s own description is the description').toBe('Install it.');
      },
    },

    {
      name: 'a document may spell its name `<namespace>.name` (#596)',
      run: (ctx) => {
        const [docs] = readCollections({ docs: { field: 'doc.category' } });

        // soundgrail's products spell it `product.name`; the derived title fell all
        // the way to a title-cased slug while the description read correctly off the
        // same namespace.
        const named = { page: { fileSlug: 'ableton-basics-level-1' }, doc: { name: 'Ableton Basics Lvl. 1' } };
        applyDocumentData(docs, named, 'CollectionsCo');
        ctx.expect(named.title).toBe('Ableton Basics Lvl. 1');
        ctx.expect(named.meta.title).toBe('Ableton Basics Lvl. 1 - Docs - CollectionsCo');
        ctx.expect(named.meta.description).toBe('Read Ableton Basics Lvl. 1 in the Docs collection.');

        // `title` is still the primary spelling: it wins when a document has both.
        const both = { page: { fileSlug: 'getting-started' }, doc: { title: 'Getting started', name: 'Never this' } };
        applyDocumentData(docs, both, 'CollectionsCo');
        ctx.expect(both.title).toBe('Getting started');
      },
    },

    {
      name: 'dev sampling accepts a declared collection, and still rejects a typo',
      run: (ctx) => {
        const collections = readCollections({ docs: { field: 'doc.category' } });

        ctx.expect(readLimits({ docs: 2 }, collections), 'a brand samples its own collection like any other').toEqual({ entries: [{ name: 'docs', limit: 2 }], randomize: false });
        ctx.expect(() => readLimits({ docs: 2 })).toThrow(/is not an OMEGA collection — the collections are posts, alternatives, team, updates/);
        ctx.expect(() => readLimits({ doc: 2 }, collections)).toThrow(/the collections are posts, alternatives, team, updates, docs/);
      },
    },

    {
      name: 'the documents publish under the collection base',
      run: (ctx) => {
        ctx.expect(DOCS.filter((url) => pages.has(url)), 'every document, at /<collection>/<slug>').toEqual(DOCS);
        ctx.expect(pages.get('/docs/api').includes('The API reference.'), 'the document renders its own body').toBeTruthy();
      },
    },

    {
      name: 'the listing paginates at the URL contract',
      run: (ctx) => {
        const first = pages.get('/docs');
        const second = pages.get('/docs/2');

        ctx.expect(first, 'page 1 IS the collection base').toBeTruthy();
        ctx.expect(second, 'page 2 hangs off it').toBeTruthy();
        ctx.expect(!pages.has('/docs/1'), 'page 1 is never also numbered').toBeTruthy();
        ctx.expect(!pages.has('/docs/3'), 'four documents at size 2 is exactly two pages').toBeTruthy();

        // URL-ascending, two per page — the order a dateless collection reproduces.
        ctx.expect(first.includes('The API') && first.includes('The CLI'), 'page 1 lists the first two documents').toBeTruthy();
        ctx.expect(!first.includes('Getting started'), 'and only those two').toBeTruthy();
        ctx.expect(second.includes('FAQ') && second.includes('Getting started'), 'page 2 lists the rest').toBeTruthy();

        ctx.expect(first.includes('<title>The Docs - CollectionsCo</title>'), 'the configured title is the page title').toBeTruthy();
        ctx.expect(first.includes('Everything, written down.'), 'and the description is the standfirst').toBeTruthy();
        ctx.expect(first.includes('href="/docs/2"'), 'page 1 links forward').toBeTruthy();
        ctx.expect(second.includes('href="/docs"'), 'page 2 links back').toBeTruthy();
      },
    },

    {
      name: 'one page per category, keyed by slug',
      run: (ctx) => {
        const guides = pages.get('/docs/categories/guides');
        const reference = pages.get('/docs/categories/reference');

        ctx.expect(guides && reference, 'both terms of the fixture').toBeTruthy();
        ctx.expect([...pages.keys()].filter((url) => url.startsWith('/docs/categories/')).length, 'the terms are grouped by slug — "Guides" and "guides" are one page').toBe(2);

        ctx.expect(guides.includes('The CLI') && guides.includes('Getting started') && guides.includes('FAQ'), 'every document of the term').toBeTruthy();
        ctx.expect(!guides.includes('The API'), 'and none of another term\'s').toBeTruthy();
        ctx.expect(guides.includes('<title>Guides - The Docs - CollectionsCo</title>'), 'the most frequent spelling names the term').toBeTruthy();
        ctx.expect(guides.includes('href="/docs"'), 'and links back to the listing').toBeTruthy();
      },
    },

    {
      name: 'every category page titles AND describes its own term (#312)',
      run: (ctx) => {
        const guides = head(pages.get('/docs/categories/guides'));
        const reference = head(pages.get('/docs/categories/reference'));
        const listing = head(pages.get('/docs'));

        // The #294 shape, one collection over: the term names the page, and the
        // description is written per term — not the site's, not the listing's.
        ctx.expect(guides.title).toBe('Guides - The Docs - CollectionsCo');
        ctx.expect(guides.description).toBe('Browse all The Docs in the Guides category.');
        ctx.expect(reference.description).toBe('Browse all The Docs in the Reference category.');

        ctx.expect(guides.title, 'never the site-wide title (brand.name is the head\'s default)').not.toBe(SITE_DATA.brand.name);
        ctx.expect(guides.description, 'never the site-wide description (brand.description is the head\'s default)').not.toBe(SITE_DATA.brand.description);
        ctx.expect(guides.description, 'and never the listing\'s — a category page is its own page').not.toBe(listing.description);
      },
    },

    {
      name: 'a generated category page is noindex, and the listing it belongs to is not (#564)',
      run: (ctx) => {
        // The blog taxonomy's posture, on a brand's own collection: a category page
        // is a list of links to pages that are themselves indexed. The generator
        // sets the flag both the robots tag and sitemap.xml read, so a declared
        // collection cannot drift from the blog.
        const robots = (url) => (pages.get(url).match(/<meta name="robots" content="([^"]*)"/) || [])[1];

        ctx.expect(robots('/docs/categories/guides'), 'a category term page is thin').toBe('noindex');
        ctx.expect(robots('/docs'), 'the listing is the collection\'s canonical page').toBe('index');
        ctx.expect(robots('/docs/2'), 'and page 2 is a duplicate of it').toBe('noindex');
        ctx.expect(robots('/docs/api'), 'the documents are the content').toBe('index');
      },
    },

    {
      name: 'every document page titles, describes and headlines ITSELF (#317)',
      run: (ctx) => {
        const api = head(pages.get('/docs/api'));
        const cli = head(pages.get('/docs/cli'));
        const listing = head(pages.get('/docs'));

        // The category page's shape, one layer down: the document names the page,
        // and its own frontmatter description is the description.
        ctx.expect(api.title).toBe('The API - The Docs - CollectionsCo');
        ctx.expect(api.description).toBe('Endpoints, payloads, errors.');
        ctx.expect(cli.title).toBe('The CLI - The Docs - CollectionsCo');
        ctx.expect(cli.description).toBe('Every verb the CLI knows.');

        ctx.expect(api.title, 'no two documents share a title').not.toBe(cli.title);
        ctx.expect(api.description, 'or a description').not.toBe(cli.description);
        ctx.expect(api.title, 'never the site-wide title (brand.name is the head\'s default)').not.toBe(SITE_DATA.brand.name);
        ctx.expect(api.description, 'never the site-wide description (brand.description is the head\'s default)').not.toBe(SITE_DATA.brand.description);
        ctx.expect(api.description, 'and never the listing\'s').not.toBe(listing.description);

        // The page a reader lands on opens with its own name.
        const h1 = (pages.get('/docs/api').match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
        ctx.expect(h1, 'the document page renders an h1').toBeTruthy();
        ctx.expect(h1.trim()).toBe('The API');
      },
    },

    {
      name: 'a declared collection publishes as site.<name>, like the built-ins (#593)',
      run: (ctx) => {
        // A UJM consumer iterates `{% for product in site.products %}`. Reaching the
        // brand's own collection only as `collections.docs` (frontmatter under
        // `.data`) rendered that loop EMPTY on a green build — six blank grid cells
        // and no warning. The fixture home page iterates `site.docs`.
        const home = pages.get('/');
        const listed = [...home.matchAll(/<li data-doc="([^"]*)">([^<]*)<\/li>/g)].map((m) => [m[1], m[2]]);

        ctx.expect(listed, 'every document, in the collection\'s own order, with its frontmatter at the top level (site.posts\' shape)').toEqual([
          ['/docs/api', 'The API'],
          ['/docs/cli', 'The CLI'],
          ['/docs/faq', 'FAQ'],
          ['/docs/getting-started', 'Getting started'],
        ]);
      },
    },

    {
      name: 'the listing rails the collection\'s own categories',
      run: (ctx) => {
        const first = pages.get('/docs');

        ctx.expect(first.includes('href="/docs/categories/guides"'), 'the Guides rail link').toBeTruthy();
        ctx.expect(first.includes('href="/docs/categories/reference"'), 'the Reference rail link').toBeTruthy();
      },
    },

    {
      name: 'a declared collection with nothing in it still gets its page',
      run: (ctx) => {
        const empty = pages.get('/recipes');

        ctx.expect(empty, 'the listing survives an empty collection — a brand declares it before writing anything').toBeTruthy();
        ctx.expect(empty.includes('Nothing here yet'), 'and says so').toBeTruthy();
        ctx.expect(empty.includes('<title>Recipes - CollectionsCo</title>'), 'the title falls back to the collection name').toBeTruthy();
        ctx.expect(!pages.has('/recipes/2'), 'nothing to paginate').toBeTruthy();
        ctx.expect([...pages.keys()].filter((url) => url.startsWith('/recipes/categories/')).length, 'no documents, no terms, no category pages').toBe(0);
      },
    },

    {
      name: 'generated pages stay out of the collections a page that writes no file must stay out of',
      run: (ctx) => {
        // The category generator is excluded in its own raw frontmatter
        // (test/collections-gate.test.js pins the rule), and Eleventy adds only page
        // 0 of a paginated template to collections — so a category page and a
        // listing page 2..N never reach the sitemap or the page index. The listing's
        // page 1 is the collection's canonical URL and DOES (#564).
        const sitemap = pages.get('/sitemap.xml');
        const index = pages.get('/pages.json');

        for (const url of ['/docs/2', '/docs/categories/guides']) {
          ctx.expect(!sitemap.includes(`${url}<`), `${url} is not a sitemap url`).toBeTruthy();
          ctx.expect(!index.includes(`"${url}"`), `${url} is not a page-index entry`).toBeTruthy();
        }
        ctx.expect(sitemap.includes('/docs<'), 'the listing itself IS a sitemap url (#564)').toBeTruthy();
        ctx.expect(sitemap.includes('/docs/api<'), 'the documents themselves DO ship in the sitemap').toBeTruthy();
      },
    },

    {
      name: 'a consumer page at a generated permalink takes the URL over',
      run: async (ctx) => {
        // The same collection, based where the fixture's own pages live: one claims
        // the listing, one claims a category page.
        const owned = await build(
          { docs: { field: 'doc.category', size: 2, permalink: '/handbook' } },
          'dynamic-pages-owned',
        );

        ctx.expect(owned.get('/handbook').includes('Hand-written handbook listing'), 'the consumer listing page wins').toBeTruthy();
        ctx.expect(!owned.get('/handbook').includes('omega-rowlist'), 'the generated listing wrote no file').toBeTruthy();

        ctx.expect(owned.get('/handbook/categories/guides').includes('Hand-written guides category'), 'the consumer category page wins').toBeTruthy();
        ctx.expect(owned.get('/handbook/categories/reference'), 'and only that one — the rest of the term pages still generate').toBeTruthy();

        ctx.expect(owned.get('/handbook/2'), 'the pagination the consumer did NOT claim still generates').toBeTruthy();
        ctx.expect(owned.has('/handbook/api'), 'and the documents follow the configured base').toBeTruthy();
      },
    },
  ],
});
